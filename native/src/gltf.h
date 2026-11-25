// Minimal glTF 2.0 (.glb) loader: positions + per-primitive color from
// material baseColorFactor, flattened into MeshData (pos3 + rgb3 per vertex)
#pragma once

#include "vk_renderer.h"

#include <string>
#include <vector>

class GltfLoader {
public:
    // Loads all primitives of all meshes into one MeshData.
    // modelScale scales metres (glTF is unit-agnostic); the aircraft assets
    // are authored small, so callers pass a scale.
    static bool load(const std::string& path, float modelScale, MeshData& out);
};
