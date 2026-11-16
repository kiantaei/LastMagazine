#include "time.h"
#include <SDL2/SDL.h>
#include <algorithm>

namespace engine::core {

TimeManager::TimeManager() {
    init();
}

void TimeManager::init() {
    m_perf_frequency = SDL_GetPerformanceFrequency();
    m_last_counter = SDL_GetPerformanceCounter();
    m_delta_time = 0.0f;
    m_accumulator = 0.0f;
    m_total_time = 0.0f;
    m_frame_count = 0;
    m_fps = 0;
    m_fps_frame_count = 0;
    m_fps_timer = 0.0f;
}

void TimeManager::update() {
    uint64_t current_counter = SDL_GetPerformanceCounter();
    double elapsed = static_cast<double>(current_counter - m_last_counter) / static_cast<double>(m_perf_frequency);
    m_last_counter = current_counter;

    // Clamp delta time to 0.1s max to prevent physics explosion after tab switches or debugger pauses
    m_delta_time = static_cast<float>(std::min(elapsed, 0.1));
    m_total_time += m_delta_time;
    m_accumulator += m_delta_time;
    m_frame_count++;

    // FPS calculation
    m_fps_frame_count++;
    m_fps_timer += m_delta_time;
    if (m_fps_timer >= 1.0f) {
        m_fps = m_fps_frame_count;
        m_fps_frame_count = 0;
        m_fps_timer -= 1.0f;
    }
}

bool TimeManager::should_fixed_step() {
    if (m_accumulator >= m_fixed_delta_time) {
        m_accumulator -= m_fixed_delta_time;
        return true;
    }
    return false;
}

} // namespace engine::core
