#pragma once

#include "../engine/core/window.h"
#include "../engine/core/time.h"
#include "../engine/input/input_manager.h"
#include "../engine/audio/audio_system.h"
#include "../engine/renderer/shader.h"
#include <memory>
#include <glm/glm.hpp>

namespace game {

class GameApp {
public:
    GameApp();
    ~GameApp();

    bool init();
    void shutdown();

    // Single frame step (called once per frame from main loop)
    void step_frame();

    bool is_running() const { return m_running; }
    void stop() { m_running = false; }

private:
    void process_input();
    void fixed_update(float fixed_dt);
    void update(float dt);
    void render(float alpha);

    void init_test_graphics();
    void render_test_tactical_display(float alpha);

    engine::core::Window m_window;
    engine::core::TimeManager m_time;
    engine::input::InputManager m_input;
    engine::audio::AudioSystem m_audio;

    std::unique_ptr<engine::renderer::Shader> m_test_shader;
    GLuint m_test_vao{0};
    GLuint m_test_vbo{0};

    bool m_running{false};
    uint64_t m_fixed_tick_count{0};
    glm::vec2 m_aim_offset{0.0f};
    float m_sway_timer{0.0f};

    // Tactical state
    int m_bullets_remaining{30};
    bool m_tactical_reload_triggered{false};
};

} // namespace game
