#pragma once

#include <SDL2/SDL.h>
#include <vector>
#include <mutex>
#include <glm/glm.hpp>

namespace engine::audio {

enum class SoundType {
    GunshotRifle,
    GunshotPistol,
    DryFire,
    ReloadStart,
    ReloadFinish,
    HitMarker,
    AmmoPickup,
    Footstep,
    Tinnitus
};

struct ActiveVoice {
    SoundType type;
    float position_seconds{0.0f};
    float duration_seconds{0.5f};
    float volume{1.0f};
    float pan_left{0.5f};
    float pan_right{0.5f};
    float pitch{1.0f};
    bool is_3d{false};
    glm::vec3 world_pos{0.0f};
    bool active{true};
};

class AudioSystem {
public:
    AudioSystem();
    ~AudioSystem();

    bool init();
    void shutdown();

    void update_listener(const glm::vec3& position, const glm::vec3& forward, const glm::vec3& right);

    void play_sound_2d(SoundType type, float volume = 1.0f, float pitch = 1.0f);
    void play_sound_3d(SoundType type, const glm::vec3& world_pos, float volume = 1.0f, float pitch = 1.0f);

    void set_master_volume(float vol) { m_master_volume = vol; }
    float master_volume() const { return m_master_volume; }

    static void audio_callback(void* userdata, uint8_t* stream, int len);

private:
    void mix(float* output_buffer, int num_samples);
    float generate_sample(ActiveVoice& voice, float dt);

    SDL_AudioDeviceID m_device{0};
    SDL_AudioSpec m_spec{};
    bool m_initialized{false};

    std::mutex m_voice_mutex;
    std::vector<ActiveVoice> m_voices;

    glm::vec3 m_listener_pos{0.0f};
    glm::vec3 m_listener_forward{0.0f, 0.0f, -1.0f};
    glm::vec3 m_listener_right{1.0f, 0.0f, 0.0f};

    float m_master_volume{0.8f};
    float m_sfx_volume{0.9f};
    float m_ambient_volume{0.4f};
};

} // namespace engine::audio
