#include "window.h"
#include "logger.h"
#include "../renderer/gl_loader.h"

namespace engine::core {

Window::Window() = default;

Window::~Window() {
    shutdown();
}

bool Window::init(const WindowConfig& config) {
    if (m_initialized) {
        return true;
    }

    m_width = config.width;
    m_height = config.height;

    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_TIMER | SDL_INIT_EVENTS) != 0) {
        Logger::critical("CORE", std::string("SDL_Init failed: ") + SDL_GetError());
        return false;
    }

#if defined(__EMSCRIPTEN__)
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
#else
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
#endif

    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    uint32_t flags = SDL_WINDOW_OPENGL | SDL_WINDOW_SHOWN | SDL_WINDOW_ALLOW_HIGHDPI;
    if (config.resizable) {
        flags |= SDL_WINDOW_RESIZABLE;
    }

    m_window = SDL_CreateWindow(
        config.title.c_str(),
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        m_width,
        m_height,
        flags
    );

    if (!m_window) {
        Logger::critical("CORE", std::string("SDL_CreateWindow failed: ") + SDL_GetError());
        return false;
    }

    m_gl_context = SDL_GL_CreateContext(m_window);
    if (!m_gl_context) {
        Logger::critical("CORE", std::string("SDL_GL_CreateContext failed: ") + SDL_GetError());
        return false;
    }

    if (SDL_GL_MakeCurrent(m_window, m_gl_context) != 0) {
        Logger::critical("CORE", std::string("SDL_GL_MakeCurrent failed: ") + SDL_GetError());
        return false;
    }

    if (config.vsync) {
        SDL_GL_SetSwapInterval(1);
    } else {
        SDL_GL_SetSwapInterval(0);
    }

    // Initialize modern OpenGL function loader
    if (!renderer::init_gl_loader()) {
        Logger::warn("CORE", "Warning: GL loader reported missing functions.");
    }

    int actual_w = 0, actual_h = 0;
    SDL_GL_GetDrawableSize(m_window, &actual_w, &actual_h);
    if (actual_w > 0 && actual_h > 0) {
        m_width = actual_w;
        m_height = actual_h;
    }
    glViewport(0, 0, m_width, m_height);

    if (config.start_mouse_locked) {
        set_relative_mouse(true);
    }

    m_initialized = true;
    Logger::info("CORE", "Window and OpenGL context created (" + std::to_string(m_width) + "x" + std::to_string(m_height) + ")");
    return true;
}

void Window::shutdown() {
    if (m_gl_context) {
        SDL_GL_DeleteContext(m_gl_context);
        m_gl_context = nullptr;
    }
    if (m_window) {
        SDL_DestroyWindow(m_window);
        m_window = nullptr;
    }
    if (m_initialized) {
        SDL_Quit();
        m_initialized = false;
        Logger::info("CORE", "Window and SDL cleanly shutdown");
    }
}

void Window::swap_buffers() {
    if (m_window) {
        SDL_GL_SwapWindow(m_window);
    }
}

void Window::set_relative_mouse(bool enabled) {
    m_relative_mouse = enabled;
    SDL_SetRelativeMouseMode(enabled ? SDL_TRUE : SDL_FALSE);
}

void Window::on_resize(int new_width, int new_height) {
    if (new_width > 0 && new_height > 0) {
        m_width = new_width;
        m_height = new_height;
        glViewport(0, 0, m_width, m_height);
    }
}

} // namespace engine::core
