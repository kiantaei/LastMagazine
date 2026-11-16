#pragma once

#include <SDL2/SDL.h>
#include <array>
#include <cstdint>

namespace engine::input {

class InputManager {
public:
    InputManager();

    void begin_frame();
    void process_event(const SDL_Event& event);

    bool is_key_down(SDL_Scancode code) const;
    bool was_key_pressed(SDL_Scancode code) const;
    bool was_key_released(SDL_Scancode code) const;

    bool is_mouse_button_down(uint8_t button) const;
    bool was_mouse_button_pressed(uint8_t button) const;
    bool was_mouse_button_released(uint8_t button) const;

    float mouse_dx() const { return m_mouse_dx; }
    float mouse_dy() const { return m_mouse_dy; }
    int mouse_x() const { return m_mouse_x; }
    int mouse_y() const { return m_mouse_y; }
    float mouse_scroll_y() const { return m_mouse_scroll_y; }

    bool should_quit() const { return m_should_quit; }
    void request_quit() { m_should_quit = true; }

    void set_mouse_sensitivity(float sens) { m_mouse_sensitivity = sens; }
    float mouse_sensitivity() const { return m_mouse_sensitivity; }

private:
    static constexpr size_t NUM_SCANCODES = SDL_NUM_SCANCODES;
    static constexpr size_t NUM_MOUSE_BUTTONS = 8;

    std::array<bool, NUM_SCANCODES> m_keys_current{};
    std::array<bool, NUM_SCANCODES> m_keys_pressed{};
    std::array<bool, NUM_SCANCODES> m_keys_released{};

    std::array<bool, NUM_MOUSE_BUTTONS> m_mouse_current{};
    std::array<bool, NUM_MOUSE_BUTTONS> m_mouse_pressed{};
    std::array<bool, NUM_MOUSE_BUTTONS> m_mouse_released{};

    int m_mouse_x{0};
    int m_mouse_y{0};
    float m_mouse_dx{0.0f};
    float m_mouse_dy{0.0f};
    float m_mouse_scroll_y{0.0f};
    float m_mouse_sensitivity{1.0f};

    bool m_should_quit{false};
};

} // namespace engine::input
