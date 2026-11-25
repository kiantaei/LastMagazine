// IRON HORIZON — world: terrain mesh, jet mesh, arcade flight model
#pragma once

#include "vk_renderer.h"

#include <glm/glm.hpp>

struct JetState {
    glm::vec3 pos{0.0f, 900.0f, 0.0f};
    float yaw = 0.0f;      // radians, 0 = -Z
    float pitch = 0.06f;   // slight nose-up spawn attitude
    float roll = 0.0f;
    float speed = 240.0f;  // m/s
    float throttle = 0.6f;
};

struct InputState {
    bool pitchUp = false, pitchDown = false;
    bool rollLeft = false, rollRight = false;
    bool yawLeft = false, yawRight = false;
    bool throttleUp = false, throttleDown = false;
};

class World {
public:
    void build();                      // fills terrain + jet meshes
    void update(const InputState& in, float dt);
    JetState jet;
    glm::vec3 sunDir{0.35f, -0.8f, 0.45f};

    MeshData terrain;
    MeshData craft;

private:
    void buildTerrain();
    void buildCraft();
    static void pushQuad(MeshData& m, const glm::vec3& a, const glm::vec3& b,
                         const glm::vec3& c, const glm::vec3& d, const glm::vec3& color);
};
