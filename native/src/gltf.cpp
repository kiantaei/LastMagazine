#include "gltf.h"

#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

// Minimal glTF 2.0 (.glb) loader: extracts POSITION (float VEC3) and indices
// per primitive, colored by material baseColorFactor, flattened into MeshData
// (pos3 + rgb3 per vertex). Custom JSON parser — no external dependency.
namespace {

struct JValue;
using JArray = std::vector<JValue>;
using JObject = std::vector<std::pair<std::string, JValue>>;

struct JValue {
    enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
    bool b = false;
    double num = 0;
    std::string str;
    JArray arr;
    JObject obj;

    bool isObj() const { return type == Obj; }
    bool isArr() const { return type == Arr; }
    size_t size() const { return arr.size(); }
    const JValue& operator[](size_t i) const { return arr[static_cast<size_t>(i)]; }
    const JValue* find(const std::string& key) const {
        for (auto& kv : obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }
    int asInt(int def = 0) const { return type == Num ? static_cast<int>(num) : def; }
    double asDouble(double def = 0) const { return type == Num ? num : def; }
};

struct Parser {
    const char* p;
    const char* end;

    void skipWs() {
        while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) ++p;
    }
    bool eat(char c) {
        skipWs();
        if (p < end && *p == c) { ++p; return true; }
        return false;
    }
    std::string parseString() {
        std::string out;
        if (!eat('"')) return out;
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) ++p;
            out.push_back(*p++);
        }
        eat('"');
        return out;
    }
    JValue parseValue() {
        JValue v;
        skipWs();
        if (p >= end) return v;
        char c = *p;
        if (c == '{') {
            v.type = JValue::Obj;
            ++p;
            if (eat('}')) return v;
            while (p < end) {
                std::string key = parseString();
                eat(':');
                v.obj.push_back({key, parseValue()});
                if (!eat(',')) break;
            }
            eat('}');
        } else if (c == '[') {
            v.type = JValue::Arr;
            ++p;
            if (eat(']')) return v;
            while (p < end) {
                v.arr.push_back(parseValue());
                if (!eat(',')) break;
            }
            eat(']');
        } else if (c == '"') {
            v.type = JValue::Str;
            v.str = parseString();
        } else if (c == 't') {
            v.type = JValue::Bool; v.b = true; p += 4;
        } else if (c == 'f') {
            v.type = JValue::Bool; v.b = false; p += 5;
        } else {
            v.type = JValue::Num;
            char* e = nullptr;
            v.num = std::strtod(p, &e);
            p = e;
        }
        return v;
    }
};

}  // namespace

bool GltfLoader::load(const std::string& path, float modelScale, MeshData& out) {
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        std::cerr << "gltf: cannot open " << path << '\n';
        return false;
    }
    char header[12];
    if (!file.read(header, 12)) return false;
    uint32_t magic, version, length;
    std::memcpy(&magic, header, 4);
    std::memcpy(&version, header + 4, 4);
    std::memcpy(&length, header + 8, 4);
    if (magic != 0x46546C67) return false;

    std::vector<char> jsonBytes, binBytes;
    while (file.tellg() >= 0 && static_cast<uint32_t>(file.tellg()) < length) {
        char ch[8];
        if (!file.read(ch, 8)) break;
        uint32_t clen, ctype;
        std::memcpy(&clen, ch, 4);
        std::memcpy(&ctype, ch + 4, 4);
        if (ctype == 0x4E4F534A) {  // JSON
            jsonBytes.resize(clen);
            if (!file.read(jsonBytes.data(), clen)) break;
        } else if (ctype == 0x004E4942) {  // BIN
            binBytes.resize(clen);
            if (!file.read(binBytes.data(), clen)) break;
        } else {
            file.seekg(clen, std::ios::cur);
        }
    }
    if (jsonBytes.empty() || binBytes.empty()) {
        std::cerr << "gltf: missing chunks in " << path << '\n';
        return false;
    }

    Parser parser{jsonBytes.data(), jsonBytes.data() + jsonBytes.size()};
    JValue root = parser.parseValue();
    const JValue* accessors = root.find("accessors");
    const JValue* bufferViews = root.find("bufferViews");
    const JValue* meshes = root.find("meshes");
    const JValue* materials = root.find("materials");
    if (!accessors || !bufferViews || !meshes) return false;

    auto accessorBytes = [&](const JValue& acc, const uint8_t*& data,
                             size_t& stride, size_t& count) -> bool {
        const JValue* viewRef = acc.find("bufferView");
        int viewIdx = viewRef ? viewRef->asInt(-1) : -1;
        if (viewIdx < 0 || static_cast<size_t>(viewIdx) >= bufferViews->size()) return false;
        const JValue& view = (*bufferViews)[static_cast<size_t>(viewIdx)];
        size_t offset = 0;
        if (const JValue* o = view.find("byteOffset")) offset = static_cast<size_t>(o->asDouble());
        if (const JValue* o = acc.find("byteOffset")) offset += static_cast<size_t>(o->asDouble());
        stride = 12;  // float VEC3 default
        if (const JValue* s = view.find("byteStride")) stride = static_cast<size_t>(s->asDouble());
        count = 0;
        if (const JValue* c = acc.find("count")) count = static_cast<size_t>(c->asDouble());
        data = reinterpret_cast<const uint8_t*>(binBytes.data()) + offset;
        return true;
    };

    size_t addedVerts = 0;
    for (const JValue& mesh : meshes->arr) {
        const JValue* prims = mesh.find("primitives");
        if (!prims) continue;
        for (const JValue& prim : prims->arr) {
            const JValue* attrs = prim.find("attributes");
            const JValue* posAccIdx = attrs ? attrs->find("POSITION") : nullptr;
            if (!posAccIdx) continue;
            const JValue& posAcc = (*accessors)[static_cast<size_t>(posAccIdx->asInt(-1))];

            glm::vec3 color{0.55f, 0.57f, 0.60f};
            if (const JValue* mi = prim.find("material")) {
                int m = mi->asInt(-1);
                if (materials && m >= 0 && static_cast<size_t>(m) < materials->size()) {
                    if (const JValue* pbr = (*materials)[static_cast<size_t>(m)].find("pbrMetallicRoughness")) {
                        if (const JValue* bcf = pbr->find("baseColorFactor")) {
                            if (bcf->arr.size() >= 3) {
                                color = {static_cast<float>(bcf->arr[0].num),
                                         static_cast<float>(bcf->arr[1].num),
                                         static_cast<float>(bcf->arr[2].num)};
                            }
                        }
                    }
                }
            }
            glm::vec3 shaded = glm::clamp(color * 1.15f, 0.08f, 1.0f);

            const uint8_t* posData = nullptr;
            size_t posStride = 0, posCount = 0;
            if (!accessorBytes(posAcc, posData, posStride, posCount)) continue;

            uint32_t startVertex = static_cast<uint32_t>(out.vertices.size() / 6);
            out.vertices.reserve(out.vertices.size() + posCount * 6);
            for (size_t i = 0; i < posCount; ++i) {
                float px, py, pz;
                std::memcpy(&px, posData + i * posStride, 4);
                std::memcpy(&py, posData + i * posStride + 4, 4);
                std::memcpy(&pz, posData + i * posStride + 8, 4);
                out.vertices.push_back(px * modelScale);
                out.vertices.push_back(py * modelScale);
                out.vertices.push_back(pz * modelScale);
                out.vertices.push_back(shaded.r);
                out.vertices.push_back(shaded.g);
                out.vertices.push_back(shaded.b);
            }
            addedVerts += posCount;

            if (const JValue* indices = prim.find("indices")) {
                const JValue& acc = (*accessors)[static_cast<size_t>(indices->asInt(-1))];
                const uint8_t* idxData = nullptr;
                size_t idxStride = 0, idxCount = 0;
                if (accessorBytes(acc, idxData, idxStride, idxCount)) {
                    int comp = acc.find("componentType") ? acc.find("componentType")->asInt() : 5123;
                    size_t w = comp == 5121 ? 1 : comp == 5123 ? 2 : 4;
                    out.indices.reserve(out.indices.size() + idxCount);
                    for (size_t i = 0; i < idxCount; ++i) {
                        uint32_t index = 0;
                        if (w == 1) { uint8_t v; std::memcpy(&v, idxData + i, 1); index = v; }
                        else if (w == 2) { uint16_t v; std::memcpy(&v, idxData + i * 2, 2); index = v; }
                        else { std::memcpy(&index, idxData + i * 4, 4); }
                        out.indices.push_back(index + startVertex);
                    }
                }
            } else {
                for (size_t i = 0; i < posCount; ++i)
                    out.indices.push_back(startVertex + static_cast<uint32_t>(i));
            }
        }
    }
    std::cout << "gltf: " << path << " loaded " << addedVerts << " vertices\n";
    return addedVerts > 0;
}
