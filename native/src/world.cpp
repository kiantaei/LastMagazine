#include "world.h"

#include <algorithm>
#include <cmath>

namespace {
float terrainHeight(float x, float z) {
    // Layered sine ridges: deterministic, no noise library needed
    float h = 0.0f;
    h += std::sin(x * 0.0009f) * std::cos(z * 0.0011f) * 320.0f;
    h += std::sin(x * 0.0037f + 1.7f) * std::cos(z * 0.0031f + 0.4f) * 120.0f;
    h += std::sin(x * 0.011f + 4.2f) * std::sin(z * 0.013f + 2.9f) * 32.0f;
    return h;
}

glm::vec3 heightColor(float h) {
    if (h > 420.0f) return {0.93f, 0.94f, 0.97f};   // snow caps
    if (h > 180.0f) return {0.45f, 0.42f, 0.36f};   // rock
    if (h > 40.0f)  return {0.27f, 0.44f, 0.22f};   // forest
    return {0.42f, 0.51f, 0.34f};                    // lowland
}
}  // namespace

void World::pushQuad(MeshData& m, const glm::vec3& a, const glm::vec3& b,
                     const glm::vec3& c, const glm::vec3& d, const glm::vec3& color) {
    uint32_t base = static_cast<uint32_t>(m.vertices.size() / 6);
    for (const glm::vec3* v : {&a, &b, &c, &d}) {
        m.vertices.push_back(v->x);
        m.vertices.push_back(v->y);
        m.vertices.push_back(v->z);
        m.vertices.push_back(color.r);
        m.vertices.push_back(color.g);
        m.vertices.push_back(color.b);
    }
    uint32_t idx[6] = {base, base + 1, base + 2, base, base + 2, base + 3};
    m.indices.insert(m.indices.end(), idx, idx + 6);
}

void World::buildTerrain() {
    constexpr float SPAN = 12000.0f;  // metres, centred on origin
    constexpr int CELLS = 180;
    constexpr float STEP = SPAN / static_cast<float>(CELLS);

    for (int cz = -CELLS / 2; cz < CELLS / 2; ++cz) {
        for (int cx = -CELLS / 2; cx < CELLS / 2; ++cx) {
            float x0 = cx * STEP, x1 = (cx + 1) * STEP;
            float z0 = cz * STEP, z1 = (cz + 1) * STEP;
            float h00 = terrainHeight(x0, z0), h10 = terrainHeight(x1, z0);
            float h01 = terrainHeight(x0, z1), h11 = terrainHeight(x1, z1);
            float hAvg = (h00 + h10 + h01 + h11) * 0.25f;
            pushQuad(terrain,
                     {x0, h00, z0}, {x1, h10, z0}, {x1, h11, z1}, {x0, h01, z1},
                     heightColor(hAvg));
        }
    }
}

void World::buildCraft() {
    // Low-poly delta-fighter, ~14 m long, nose toward -Z
    const glm::vec3 body = {0.28f, 0.31f, 0.36f};
    const glm::vec3 canopy = {0.12f, 0.55f, 0.75f};
    const glm::vec3 trim = {0.85f, 0.62f, 0.04f};

    glm::vec3 nose = {0, 0, -7.0f};
    glm::vec3 tailL = {-1.6f, 0, 6.5f};
    glm::vec3 tailR = {1.6f, 0, 6.5f};
    glm::vec3 tailTop = {0, 1.5f, 6.0f};
    glm::vec3 belly = {0, -0.9f, 1.0f};
    glm::vec3 wingL = {-7.0f, 0, 5.0f};
    glm::vec3 wingR = {7.0f, 0, 5.0f};

    auto tri = [&](const glm::vec3& a, const glm::vec3& b, const glm::vec3& c,
                   const glm::vec3& color) {
        uint32_t base = static_cast<uint32_t>(craft.vertices.size() / 6);
        for (const glm::vec3* v : {&a, &b, &c}) {
            craft.vertices.push_back(v->x);
            craft.vertices.push_back(v->y);
            craft.vertices.push_back(v->z);
            craft.vertices.push_back(color.r);
            craft.vertices.push_back(color.g);
            craft.vertices.push_back(color.b);
        }
        uint32_t idx[3] = {base, base + 1, base + 2};
        craft.indices.insert(craft.indices.end(), idx, idx + 3);
    };

    tri(nose, tailL, tailR, body);            // top hull
    tri(nose, belly, tailL, body);            // left underside
    tri(nose, tailR, belly, body);            // right underside
    tri(nose, wingL, tailL, body);            // left wing
    tri(nose, tailR, wingR, body);            // right wing
    tri({0, 0.45f, -2.0f}, {0.9f, 0.35f, 2.5f}, {-0.9f, 0.35f, 2.5f}, canopy);
    tri(tailTop, tailL, tailR, trim);         // tail stripe
}

void World::build() {
    buildTerrain();
    buildCraft();
}

void World::update(const InputState& in, float dt) {
    constexpr float PITCH_RATE = 1.6f;
    constexpr float ROLL_RATE = 2.4f;
    constexpr float YAW_RATE = 0.5f;
    constexpr float THROTTLE_RATE = 0.6f;
    constexpr float MIN_SPEED = 90.0f, MAX_SPEED = 680.0f;

    if (in.pitchUp) jet.pitch = std::clamp(jet.pitch + PITCH_RATE * dt, -1.2f, 1.2f);
    if (in.pitchDown) jet.pitch = std::clamp(jet.pitch - PITCH_RATE * dt, -1.2f, 1.2f);
    if (in.rollLeft) jet.roll = std::clamp(jet.roll - ROLL_RATE * dt, -1.4f, 1.4f);
    if (in.rollRight) jet.roll = std::clamp(jet.roll + ROLL_RATE * dt, -1.4f, 1.4f);
    if (in.yawLeft) jet.yaw -= YAW_RATE * dt;
    if (in.yawRight) jet.yaw += YAW_RATE * dt;

    // Banked turn: roll attitude drags the nose around the horizon
    jet.yaw += jet.roll * 0.9f * dt;
    jet.roll *= 1.0f - (in.rollLeft || in.rollRight ? 0.0f : 0.9f) * dt;  // self-centre

    if (in.throttleUp) jet.throttle = std::clamp(jet.throttle + THROTTLE_RATE * dt, 0.0f, 1.0f);
    if (in.throttleDown) jet.throttle = std::clamp(jet.throttle - THROTTLE_RATE * dt, 0.0f, 1.0f);

    float targetSpeed = MIN_SPEED + jet.throttle * (MAX_SPEED - MIN_SPEED);
    jet.speed += (targetSpeed - jet.speed) * std::min(1.0f, 1.5f * dt);

    // Gravity bleed-off and lift gain with speed
    jet.pitch -= 0.12f * dt / std::max(0.35f, jet.speed / 240.0f);
    jet.pitch = std::clamp(jet.pitch, -1.2f, 1.2f);

    glm::vec3 fwd{
        std::sin(jet.yaw) * std::cos(jet.pitch),
        std::sin(jet.pitch),
        -std::cos(jet.yaw) * std::cos(jet.pitch),
    };
    jet.pos += fwd * (jet.speed * dt);

    // Never fly through terrain
    float ground = terrainHeight(jet.pos.x, jet.pos.z) + 40.0f;
    if (jet.pos.y < ground) {
        jet.pos.y = ground;
        jet.pitch = std::max(jet.pitch, 0.15f);
    }
    if (jet.pos.y > 12000.0f) jet.pos.y = 12000.0f;
}
