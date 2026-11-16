#pragma once

#include <cstdint>

namespace engine::core {

class TimeManager {
public:
    TimeManager();

    void init();
    void update();

    // Returns true if a fixed step should be processed.
    // Call in a while loop: while (time.should_fixed_step()) { ... }
    bool should_fixed_step();

    float delta_time() const { return m_delta_time; }
    float fixed_delta_time() const { return m_fixed_delta_time; }
    float interpolation_alpha() const { return m_accumulator / m_fixed_delta_time; }
    float total_time() const { return m_total_time; }
    uint64_t frame_count() const { return m_frame_count; }
    uint32_t current_fps() const { return m_fps; }

    void set_fixed_timestep(float hz) {
        if (hz > 0.0f) {
            m_fixed_delta_time = 1.0f / hz;
        }
    }

private:
    uint64_t m_perf_frequency{0};
    uint64_t m_last_counter{0};

    float m_delta_time{0.0f};
    float m_fixed_delta_time{1.0f / 60.0f}; // 60 Hz standard
    float m_accumulator{0.0f};
    float m_total_time{0.0f};

    uint64_t m_frame_count{0};
    uint32_t m_fps{0};
    uint32_t m_fps_frame_count{0};
    float m_fps_timer{0.0f};
};

} // namespace engine::core
