#include "game_app.h"
#include "../engine/core/logger.h"
#include <glm/gtc/matrix_transform.hpp>
#include <cmath>

namespace game {

// Embedded GLSL 300 es / 330 core shaders for Milestone 1 tactical verification
static const char* TACTICAL_VERT = R"(
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;

uniform mat4 u_mvp;

out vec4 v_color;
out vec2 v_pos;

void main() {
    v_color = a_color;
    v_pos = a_pos;
    gl_Position = u_mvp * vec4(a_pos, 0.0, 1.0);
}
)";

static const char* TACTICAL_FRAG = R"(
in vec4 v_color;
in vec2 v_pos;

uniform float u_time;
uniform vec2 u_resolution;
uniform int u_ammo;
uniform int u_locked;

out vec4 frag_color;

void main() {
    // Distance from center of element
    float dist = length(v_pos);
    
    // Subtle animated tactical pulse ring
    float pulse = 0.5 + 0.5 * sin(u_time * 4.0);
    vec4 col = v_color;
    
    // Low ammo tactical emergency warning coloration
    if (u_ammo <= 5) {
        col.rgb = mix(col.rgb, vec3(1.0, 0.15, 0.1), pulse * 0.8);
    }
    
    // Soft glow falloff
    float glow = smoothstep(0.8, 0.2, dist);
    frag_color = vec4(col.rgb, col.a * glow);
}
)";

GameApp::GameApp() = default;

GameApp::~GameApp() {
    shutdown();
}

bool GameApp::init() {
    engine::core::Logger::info("GAME", "==================================================");
    engine::core::Logger::info("GAME", "   LAST MAGAZINE - AAA TACTICAL FPS (ENGINE M1)   ");
    engine::core::Logger::info("GAME", "   Target: WebGL 2 (GLES 3.0) / Native Desktop    ");
    engine::core::Logger::info("GAME", "==================================================");

    engine::core::WindowConfig config{};
    config.title = "LAST MAGAZINE - Every Bullet Is A Decision [M1]";
    config.width = 1280;
    config.height = 720;
    config.resizable = true;
    config.vsync = true;
    config.start_mouse_locked = false;

    if (!m_window.init(config)) {
        engine::core::Logger::critical("GAME", "Failed to initialize engine window.");
        return false;
    }

    m_time.init();
    m_audio.init();

    init_test_graphics();

    m_running = true;
    engine::core::Logger::info("GAME", "GameApp initialized successfully. Ready for combat loop.");
    return true;
}

void GameApp::shutdown() {
    if (m_test_vao != 0) {
        glDeleteVertexArrays(1, &m_test_vao);
        m_test_vao = 0;
    }
    if (m_test_vbo != 0) {
        glDeleteBuffers(1, &m_test_vbo);
        m_test_vbo = 0;
    }

    m_test_shader.reset();
    m_audio.shutdown();
    m_window.shutdown();
    m_running = false;
    engine::core::Logger::info("GAME", "GameApp shutdown cleanly.");
}

void GameApp::init_test_graphics() {
    m_test_shader = std::make_unique<engine::renderer::Shader>();
    if (!m_test_shader->load_from_source(TACTICAL_VERT, TACTICAL_FRAG)) {
        engine::core::Logger::error("GAME", "Failed to compile tactical test shader.");
    }

    // Reticle & Tactical Calibration Crosshair geometry
    // Vertex format: x, y, r, g, b, a
    struct Vertex {
        float x, y;
        float r, g, b, a;
    };

    std::vector<Vertex> vertices;

    // Outer tactical reticle diamond
    float d = 0.35f;
    float alpha = 0.85f;
    glm::vec3 cyan(0.15f, 0.85f, 0.95f);
    glm::vec3 amber(1.0f, 0.72f, 0.18f);

    // Crosshair ticks
    float tick_inner = 0.04f;
    float tick_outer = 0.16f;

    auto add_line = [&](float x0, float y0, float x1, float y1, const glm::vec3& c) {
        vertices.push_back({x0, y0, c.r, c.g, c.b, alpha});
        vertices.push_back({x1, y1, c.r, c.g, c.b, alpha});
    };

    // 4 cardinal tactical reticle brackets
    add_line(-tick_outer, 0.0f, -tick_inner, 0.0f, cyan);
    add_line( tick_inner, 0.0f,  tick_outer, 0.0f, cyan);
    add_line(0.0f, -tick_outer, 0.0f, -tick_inner, cyan);
    add_line(0.0f,  tick_inner, 0.0f,  tick_outer, cyan);

    // Diagonal corner brackets (Call of Duty tactical ADS style)
    float cd = 0.22f;
    float cs = 0.05f;
    // Top-Left bracket
    add_line(-cd, cd, -cd + cs, cd, amber);
    add_line(-cd, cd, -cd, cd - cs, amber);
    // Top-Right bracket
    add_line(cd, cd, cd - cs, cd, amber);
    add_line(cd, cd, cd, cd - cs, amber);
    // Bottom-Left bracket
    add_line(-cd, -cd, -cd + cs, -cd, amber);
    add_line(-cd, -cd, -cd, -cd + cs, amber);
    // Bottom-Right bracket
    add_line(cd, -cd, cd - cs, -cd, amber);
    add_line(cd, -cd, cd, -cd + cs, amber);

    // Outer rotating diamond
    add_line(0.0f, d, d, 0.0f, cyan);
    add_line(d, 0.0f, 0.0f, -d, cyan);
    add_line(0.0f, -d, -d, 0.0f, cyan);
    add_line(-d, 0.0f, 0.0f, d, cyan);

    glGenVertexArrays(1, &m_test_vao);
    glBindVertexArray(m_test_vao);

    glGenBuffers(1, &m_test_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, m_test_vbo);
    glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);

    // Attribute 0: position (vec2)
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), reinterpret_cast<void*>(0));

    // Attribute 1: color (vec4)
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(Vertex), reinterpret_cast<void*>(2 * sizeof(float)));

    glBindVertexArray(0);
    glBindBuffer(GL_ARRAY_BUFFER, 0);

    engine::core::Logger::info("GAME", "Tactical reticle calibration geometry uploaded (Vertices: " + std::to_string(vertices.size()) + ")");
}

void GameApp::process_input() {
    m_input.begin_frame();

    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        if (event.type == SDL_QUIT) {
            m_running = false;
        } else if (event.type == SDL_WINDOWEVENT) {
            if (event.window.event == SDL_WINDOWEVENT_RESIZED || event.window.event == SDL_WINDOWEVENT_SIZE_CHANGED) {
                m_window.on_resize(event.window.data1, event.window.data2);
            }
        } else {
            m_input.process_event(event);
        }
    }

    if (m_input.should_quit()) {
        m_running = false;
    }

    // Toggle pointer lock with ESC or Click
    if (m_input.was_key_pressed(SDL_SCANCODE_ESCAPE)) {
        bool locked = m_window.is_relative_mouse();
        m_window.set_relative_mouse(!locked);
        engine::core::Logger::info("INPUT", std::string("Pointer Lock toggled: ") + (!locked ? "LOCKED" : "UNLOCKED"));
    }

    // Left mouse click to lock pointer if unlocked, or fire weapon if locked
    if (m_input.was_mouse_button_pressed(SDL_BUTTON_LEFT)) {
        if (!m_window.is_relative_mouse()) {
            m_window.set_relative_mouse(true);
            engine::core::Logger::info("INPUT", "Pointer locked via mouse click.");
        } else {
            // Weapon Fire
            if (m_bullets_remaining > 0) {
                m_bullets_remaining--;
                m_audio.play_sound_2d(engine::audio::SoundType::GunshotRifle, 1.0f, 1.0f);
                engine::core::Logger::info("GAME", "BANG! Bullet fired. Remaining in current magazine: " + std::to_string(m_bullets_remaining));
                if (m_bullets_remaining == 0) {
                    engine::core::Logger::warn("GAME", "MAGAZINE EMPTY! Press 'R' to insert your last magazine.");
                }
            } else {
                m_audio.play_sound_2d(engine::audio::SoundType::DryFire, 0.8f, 1.2f);
                engine::core::Logger::warn("GAME", "*CLICK* Dry fire! No ammo in magazine!");
            }
        }
    }

    // Tactical Reload mechanic: Discards the remaining bullets in the old magazine!
    if (m_input.was_key_pressed(SDL_SCANCODE_R)) {
        if (m_bullets_remaining > 0 && m_bullets_remaining < 30) {
            engine::core::Logger::warn("GAME", "TACTICAL RELOAD: Discarded " + std::to_string(m_bullets_remaining) + " unfired rounds with old magazine!");
        } else {
            engine::core::Logger::info("GAME", "Reloading fresh magazine...");
        }
        m_audio.play_sound_2d(engine::audio::SoundType::ReloadStart, 0.9f, 1.0f);
        m_bullets_remaining = 30;
    }

    // Audio test triggers
    if (m_input.was_key_pressed(SDL_SCANCODE_SPACE)) {
        m_audio.play_sound_2d(engine::audio::SoundType::HitMarker, 1.0f, 1.0f);
        engine::core::Logger::info("AUDIO", "Triggered HitMarker sound effect");
    }

    if (m_input.was_key_pressed(SDL_SCANCODE_TAB)) {
        m_audio.play_sound_2d(engine::audio::SoundType::Tinnitus, 0.7f, 1.0f);
        engine::core::Logger::info("AUDIO", "Triggered Tinnitus sound effect");
    }

    // Update aim offset with mouse look
    if (m_window.is_relative_mouse()) {
        float sens = 0.0015f;
        m_aim_offset.x += m_input.mouse_dx() * sens;
        m_aim_offset.y -= m_input.mouse_dy() * sens;
    }
}

void GameApp::fixed_update(float fixed_dt) {
    m_fixed_tick_count++;

    // Weapon sway simulation at 60 Hz
    m_sway_timer += fixed_dt;

    // Decay aim offset toward center
    m_aim_offset *= 0.92f;
}

void GameApp::update(float dt) {
    (void)dt;
    // Variable timestep systems (animations, visual smoothing)
}

void GameApp::render(float alpha) {
    // Dusk tactical atmosphere background
    glClearColor(0.045f, 0.055f, 0.075f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    render_test_tactical_display(alpha);
}

void GameApp::render_test_tactical_display(float alpha) {
    (void)alpha;
    if (!m_test_shader || !m_test_shader->is_valid()) return;

    m_test_shader->use();

    float aspect = m_window.aspect_ratio();
    glm::mat4 proj = glm::ortho(-aspect, aspect, -1.0f, 1.0f, -1.0f, 1.0f);

    // Apply procedural weapon sway and recoil offset
    float sway_x = std::sin(m_sway_timer * 1.5f) * 0.015f + m_aim_offset.x;
    float sway_y = std::cos(m_sway_timer * 3.0f) * 0.008f + m_aim_offset.y;

    glm::mat4 model = glm::mat4(1.0f);
    model = glm::translate(model, glm::vec3(sway_x, sway_y, 0.0f));

    // Slow tactical rotation of outer diamond
    float angle = m_sway_timer * 0.25f;
    model = glm::rotate(model, angle, glm::vec3(0.0f, 0.0f, 1.0f));

    glm::mat4 mvp = proj * model;

    m_test_shader->set_mat4("u_mvp", mvp);
    m_test_shader->set_float("u_time", m_time.total_time());
    m_test_shader->set_vec2("u_resolution", glm::vec2(m_window.width(), m_window.height()));
    m_test_shader->set_int("u_ammo", m_bullets_remaining);
    m_test_shader->set_int("u_locked", m_window.is_relative_mouse() ? 1 : 0);

    glBindVertexArray(m_test_vao);
    glDrawArrays(GL_LINES, 0, 24);
    glBindVertexArray(0);

    m_test_shader->unbind();
}

void GameApp::step_frame() {
    process_input();

    m_time.update();

    // Fixed timestep accumulator loop (60 Hz physics / logic)
    while (m_time.should_fixed_step()) {
        fixed_update(m_time.fixed_delta_time());
    }

    update(m_time.delta_time());

    render(m_time.interpolation_alpha());

    m_window.swap_buffers();
}

} // namespace game
