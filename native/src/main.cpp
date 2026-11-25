// IRON HORIZON — native entry point (Vulkan + GLFW)
#include "vk_renderer.h"
#include "world.h"
#include "gltf.h"

#include <glm/gtc/matrix_transform.hpp>

#include <chrono>
#include <cmath>
#include <iostream>
#include <vector>

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

int main() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);   // no OpenGL: raw Vulkan
    glfwWindowHint(GLFW_RESIZABLE, GLFW_TRUE);
    GLFWwindow* window = glfwCreateWindow(1600, 900, "IRON HORIZON // VULKAN", nullptr, nullptr);
    if (!window) {
        std::cerr << "window creation failed\n";
        glfwTerminate();
        return 1;
    }

    VulkanRenderer renderer;
    World world;
    uint32_t terrainIndexBase = 0, craftVertexBase = 0, craftIndexBase = 0;
    try {
        renderer.init(window);
        world.build();

        // Real aircraft model: glb replaces the built-in low-poly craft.
        // f16.glb is authored ~17 m long (nose -Z) — scale 1 keeps real size.
        MeshData craftModel;
        if (GltfLoader::load("assets/models/aircraft/f16.glb", 1.0f, craftModel)) {
            world.craft = std::move(craftModel);
            std::cout << "using f16.glb for player craft\n";
        } else {
            std::cout << "falling back to built-in craft mesh\n";
        }

        renderer.uploadMesh(world.terrain);
        renderer.uploadMesh(world.craft);
        terrainIndexBase = 0;
        craftVertexBase = static_cast<uint32_t>(renderer.vertexBase() - world.craft.vertices.size() / 6);
        craftIndexBase = static_cast<uint32_t>(renderer.indexBase() - world.craft.indices.size());
    } catch (const std::exception& e) {
        std::cerr << "fatal: " << e.what() << '\n';
        glfwTerminate();
        return 1;
    }

    InputState input;
    auto last = std::chrono::steady_clock::now();

    while (!glfwWindowShouldClose(window)) {
        glfwPollEvents();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last).count();
        last = now;
        dt = std::min(dt, 0.05f);

        input.pitchUp = glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS;
        input.pitchDown = glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS;
        input.rollLeft = glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS;
        input.rollRight = glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS;
        input.yawLeft = glfwGetKey(window, GLFW_KEY_Q) == GLFW_PRESS;
        input.yawRight = glfwGetKey(window, GLFW_KEY_E) == GLFW_PRESS;
        input.throttleUp = glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS;
        input.throttleDown = glfwGetKey(window, GLFW_KEY_LEFT_CONTROL) == GLFW_PRESS;

        world.update(input, dt);

        const JetState& j = world.jet;
        glm::vec3 fwd{
            std::sin(j.yaw) * std::cos(j.pitch),
            std::sin(j.pitch),
            -std::cos(j.yaw) * std::cos(j.pitch),
        };
        bool debugCam = getenv("IH_DEBUG_CAM") != nullptr;
        glm::vec3 chase = j.pos - fwd * 26.0f + glm::vec3(0, 4, 0);
        if (debugCam) chase = j.pos + glm::vec3(30, 8, 30);  // side view of the model
        glm::mat4 view = glm::lookAt(chase, debugCam ? j.pos : j.pos + fwd * 60.0f, glm::vec3(0, 1, 0));
        glm::mat4 proj = glm::perspective(
            glm::radians(64.0f),
            1600.0f / 900.0f,  // corrected per frame below with actual extent
            1.0f, 30000.0f);

        // Jet orientation: yaw, pitch and roll as a basis matrix
        glm::mat4 roll = glm::rotate(glm::mat4(1.0f), j.roll, glm::vec3(0, 0, 1));
        glm::mat4 pitch = glm::rotate(glm::mat4(1.0f), -j.pitch, glm::vec3(1, 0, 0));
        glm::mat4 yawM = glm::rotate(glm::mat4(1.0f), -j.yaw, glm::vec3(0, 1, 0));
        glm::mat4 model = glm::translate(glm::mat4(1.0f), j.pos) * yawM * pitch * roll;

        // Correct aspect from the current framebuffer size
        int fbw = 0, fbh = 0;
        glfwGetFramebufferSize(window, &fbw, &fbh);
        if (fbh > 0) proj = glm::perspective(glm::radians(64.0f), static_cast<float>(fbw) / static_cast<float>(fbh), 1.0f, 30000.0f);

        std::vector<DrawItem> items;
        items.push_back({terrainIndexBase,
                         static_cast<uint32_t>(world.terrain.indices.size()), 0, proj * view});
        items.push_back({craftIndexBase,
                         static_cast<uint32_t>(world.craft.indices.size()),
                         0,  // indices are rebased at upload; no vertexOffset
                         proj * view * model});

        renderer.drawFrame(items);
        if (renderer.frameTimeout) renderer.frameTimeout = false;
    }

    renderer.waitIdle();
    renderer.cleanup();
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
