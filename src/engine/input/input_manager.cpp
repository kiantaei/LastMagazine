#include "input_manager.h"
#include <algorithm>

namespace engine::input {

InputManager::InputManager() {
    m_keys_current.fill(false);
    m_keys_pressed.fill(false);
    m_keys_released.fill(false);
    m_mouse_current.fill(false);
    m_mouse_pressed.fill(false);
    m_mouse_released.fill(false);
}

void InputManager::begin_frame() {
    m_keys_pressed.fill(false);
    m_keys_released.fill(false);
    m_mouse_pressed.fill(false);
    m_mouse_released.fill(false);
    m_mouse_dx = 0.0f;
    m_mouse_dy = 0.0f;
    m_mouse_scroll_y = 0.0f;
}

void InputManager::process_event(const SDL_Event& event) {
    switch (event.type) {
        case SDL_QUIT:
            m_should_quit = true;
            break;

        case SDL_KEYDOWN: {
            SDL_Scancode code = event.key.keysym.scancode;
            if (code < NUM_SCANCODES && !event.key.repeat) {
                m_keys_current[code] = true;
                m_keys_pressed[code] = true;
            }
            break;
        }

        case SDL_KEYUP: {
            SDL_Scancode code = event.key.keysym.scancode;
            if (code < NUM_SCANCODES) {
                m_keys_current[code] = false;
                m_keys_released[code] = true;
            }
            break;
        }

        case SDL_MOUSEBUTTONDOWN: {
            uint8_t btn = event.button.button;
            if (btn < NUM_MOUSE_BUTTONS) {
                m_mouse_current[btn] = true;
                m_mouse_pressed[btn] = true;
            }
            break;
        }

        case SDL_MOUSEBUTTONUP: {
            uint8_t btn = event.button.button;
            if (btn < NUM_MOUSE_BUTTONS) {
                m_mouse_current[btn] = false;
                m_mouse_released[btn] = true;
            }
            break;
        }

        case SDL_MOUSEMOTION: {
            m_mouse_x = event.motion.x;
            m_mouse_y = event.motion.y;
            m_mouse_dx += static_cast<float>(event.motion.xrel) * m_mouse_sensitivity;
            m_mouse_dy += static_cast<float>(event.motion.yrel) * m_mouse_sensitivity;
            break;
        }

        case SDL_MOUSEWHEEL: {
            m_mouse_scroll_y += static_cast<float>(event.wheel.y);
            break;
        }

        default:
            break;
    }
}

bool InputManager::is_key_down(SDL_Scancode code) const {
    if (code < NUM_SCANCODES) return m_keys_current[code];
    return false;
}

bool InputManager::was_key_pressed(SDL_Scancode code) const {
    if (code < NUM_SCANCODES) return m_keys_pressed[code];
    return false;
}

bool InputManager::was_key_released(SDL_Scancode code) const {
    if (code < NUM_SCANCODES) return m_keys_released[code];
    return false;
}

bool InputManager::is_mouse_button_down(uint8_t button) const {
    if (button < NUM_MOUSE_BUTTONS) return m_mouse_current[button];
    return false;
}

bool InputManager::was_mouse_button_pressed(uint8_t button) const {
    if (button < NUM_MOUSE_BUTTONS) return m_mouse_pressed[button];
    return false;
}

bool InputManager::was_mouse_button_released(uint8_t button) const {
    if (button < NUM_MOUSE_BUTTONS) return m_mouse_released[button];
    return false;
}

} // namespace engine::input
