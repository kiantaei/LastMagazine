#pragma once

#include <SDL2/SDL.h>
#include <string>

namespace engine::core {

struct WindowConfig {
    std::string title{"LAST MAGAZINE"};
    int width{1280};
    int height{720};
    bool resizable{true};
    bool vsync{true};
    bool start_mouse_locked{false};
};

class Window {
public:
    Window();
    ~Window();

    bool init(const WindowConfig& config);
    void shutdown();

    void swap_buffers();
    void set_relative_mouse(bool enabled);
    bool is_relative_mouse() const { return m_relative_mouse; }

    int width() const { return m_width; }
    int height() const { return m_height; }
    float aspect_ratio() const { return m_height > 0 ? static_cast<float>(m_width) / static_cast<float>(m_height) : 16.0f / 9.0f; }

    SDL_Window* sdl_window() const { return m_window; }
    SDL_GLContext gl_context() const { return m_gl_context; }

    void on_resize(int new_width, int new_height);

private:
    SDL_Window* m_window{nullptr};
    SDL_GLContext m_gl_context{nullptr};
    int m_width{1280};
    int m_height{720};
    bool m_relative_mouse{false};
    bool m_initialized{false};
};

} // namespace engine::core
