#include "audio_system.h"
#include "../core/logger.h"
#include <cmath>
#include <random>
#include <algorithm>

namespace engine::audio {

AudioSystem::AudioSystem() = default;

AudioSystem::~AudioSystem() {
    shutdown();
}

bool AudioSystem::init() {
    if (m_initialized) return true;

    SDL_AudioSpec desired{};
    desired.freq = 44100;
    desired.format = AUDIO_S16SYS;
    desired.channels = 2;
    desired.samples = 1024;
    desired.callback = audio_callback;
    desired.userdata = this;

    m_device = SDL_OpenAudioDevice(nullptr, 0, &desired, &m_spec, 0);
    if (m_device == 0) {
        core::Logger::warn("AUDIO", std::string("SDL_OpenAudioDevice failed: ") + SDL_GetError() + " (Audio will be disabled)");
        return false;
    }

    m_voices.reserve(32);
    SDL_PauseAudioDevice(m_device, 0); // Start playback
    m_initialized = true;

    core::Logger::info("AUDIO", "Procedural 3D Audio System initialized (44100Hz Stereo)");
    return true;
}

void AudioSystem::shutdown() {
    if (m_device != 0) {
        SDL_CloseAudioDevice(m_device);
        m_device = 0;
    }
    m_initialized = false;
}

void AudioSystem::update_listener(const glm::vec3& position, const glm::vec3& forward, const glm::vec3& right) {
    m_listener_pos = position;
    m_listener_forward = glm::normalize(forward);
    m_listener_right = glm::normalize(right);
}

void AudioSystem::play_sound_2d(SoundType type, float volume, float pitch) {
    if (!m_initialized) return;

    ActiveVoice voice{};
    voice.type = type;
    voice.volume = volume * m_sfx_volume;
    voice.pitch = pitch;
    voice.pan_left = 0.5f;
    voice.pan_right = 0.5f;
    voice.is_3d = false;

    switch (type) {
        case SoundType::GunshotRifle:  voice.duration_seconds = 0.35f; break;
        case SoundType::GunshotPistol: voice.duration_seconds = 0.25f; break;
        case SoundType::DryFire:       voice.duration_seconds = 0.05f; break;
        case SoundType::ReloadStart:   voice.duration_seconds = 0.40f; break;
        case SoundType::ReloadFinish:  voice.duration_seconds = 0.30f; break;
        case SoundType::HitMarker:     voice.duration_seconds = 0.06f; break;
        case SoundType::AmmoPickup:    voice.duration_seconds = 0.20f; break;
        case SoundType::Footstep:      voice.duration_seconds = 0.12f; break;
        case SoundType::Tinnitus:      voice.duration_seconds = 3.00f; break;
    }

    std::lock_guard<std::mutex> lock(m_voice_mutex);
    m_voices.push_back(voice);
}

void AudioSystem::play_sound_3d(SoundType type, const glm::vec3& world_pos, float volume, float pitch) {
    if (!m_initialized) return;

    glm::vec3 to_source = world_pos - m_listener_pos;
    float dist = glm::length(to_source);
    if (dist < 0.001f) {
        play_sound_2d(type, volume, pitch);
        return;
    }

    glm::vec3 dir = to_source / dist;
    float pan = glm::dot(dir, m_listener_right); // -1 (left) to +1 (right)
    float pan_r = 0.5f + (pan * 0.4f);
    float pan_l = 1.0f - pan_r;

    // Distance attenuation (inverse distance falloff)
    float ref_dist = 2.0f;
    float max_dist = 60.0f;
    float atten = 1.0f / (1.0f + (dist / ref_dist));
    if (dist > max_dist) atten = 0.0f;

    ActiveVoice voice{};
    voice.type = type;
    voice.volume = volume * m_sfx_volume * atten;
    voice.pitch = pitch;
    voice.pan_left = pan_l;
    voice.pan_right = pan_r;
    voice.is_3d = true;
    voice.world_pos = world_pos;

    switch (type) {
        case SoundType::GunshotRifle:  voice.duration_seconds = 0.45f; break;
        case SoundType::GunshotPistol: voice.duration_seconds = 0.30f; break;
        case SoundType::DryFire:       voice.duration_seconds = 0.05f; break;
        case SoundType::ReloadStart:   voice.duration_seconds = 0.40f; break;
        case SoundType::ReloadFinish:  voice.duration_seconds = 0.30f; break;
        case SoundType::HitMarker:     voice.duration_seconds = 0.06f; break;
        case SoundType::AmmoPickup:    voice.duration_seconds = 0.20f; break;
        case SoundType::Footstep:      voice.duration_seconds = 0.12f; break;
        case SoundType::Tinnitus:      voice.duration_seconds = 3.00f; break;
    }

    std::lock_guard<std::mutex> lock(m_voice_mutex);
    m_voices.push_back(voice);
}

void AudioSystem::audio_callback(void* userdata, uint8_t* stream, int len) {
    auto* self = static_cast<AudioSystem*>(userdata);
    int num_samples = len / sizeof(int16_t); // Interleaved L, R
    int num_frames = num_samples / 2;

    std::vector<float> mix_buffer(num_samples, 0.0f);
    self->mix(mix_buffer.data(), num_frames);

    int16_t* out = reinterpret_cast<int16_t*>(stream);
    for (int i = 0; i < num_samples; ++i) {
        float s = mix_buffer[i] * self->m_master_volume;
        s = std::clamp(s, -1.0f, 1.0f);
        out[i] = static_cast<int16_t>(s * 32767.0f);
    }
}

float AudioSystem::generate_sample(ActiveVoice& voice, float dt) {
    float t = voice.position_seconds;
    float norm_t = t / voice.duration_seconds;
    float sample = 0.0f;

    static thread_local std::mt19937 rng(1337);
    static thread_local std::uniform_real_distribution<float> noise_dist(-1.0f, 1.0f);

    switch (voice.type) {
        case SoundType::GunshotRifle: {
            // Explosive noise burst + sharp decay + low boom
            float noise = noise_dist(rng);
            float env = std::exp(-norm_t * 12.0f);
            float boom = std::sin(t * 120.0f * 6.28318f) * std::exp(-norm_t * 6.0f);
            sample = (noise * 0.7f + boom * 0.5f) * env;
            break;
        }
        case SoundType::GunshotPistol: {
            // Snappy high-crack noise burst
            float noise = noise_dist(rng);
            float env = std::exp(-norm_t * 16.0f);
            float crack = std::sin(t * 280.0f * 6.28318f) * std::exp(-norm_t * 14.0f);
            sample = (noise * 0.6f + crack * 0.4f) * env;
            break;
        }
        case SoundType::DryFire: {
            // Metallic click
            float env = std::exp(-norm_t * 30.0f);
            float click = std::sin(t * 2400.0f * 6.28318f) * 0.6f + noise_dist(rng) * 0.4f;
            sample = click * env;
            break;
        }
        case SoundType::HitMarker: {
            // High-pitched tactical tick/blip
            float env = 1.0f - norm_t;
            float tone = std::sin(t * 1800.0f * 6.28318f);
            sample = tone * env;
            break;
        }
        case SoundType::AmmoPickup: {
            // Two-tone rising pickup chime
            float freq = (norm_t < 0.5f) ? 550.0f : 880.0f;
            float env = 1.0f - norm_t;
            sample = std::sin(t * freq * 6.28318f) * env;
            break;
        }
        case SoundType::Footstep: {
            // Low thud + grit
            float env = std::exp(-norm_t * 18.0f);
            float thud = std::sin(t * 90.0f * 6.28318f);
            float grit = noise_dist(rng) * 0.2f;
            sample = (thud + grit) * env;
            break;
        }
        case SoundType::Tinnitus: {
            // High pure ringing tone decaying over 3s
            float env = std::exp(-norm_t * 1.5f);
            sample = std::sin(t * 3800.0f * 6.28318f) * env * 0.3f;
            break;
        }
        default:
            sample = 0.0f;
            break;
    }

    voice.position_seconds += dt * voice.pitch;
    if (voice.position_seconds >= voice.duration_seconds) {
        voice.active = false;
    }

    return sample * voice.volume;
}

void AudioSystem::mix(float* output_buffer, int num_frames) {
    std::lock_guard<std::mutex> lock(m_voice_mutex);
    float dt = 1.0f / 44100.0f;

    for (int i = 0; i < num_frames; ++i) {
        float left = 0.0f;
        float right = 0.0f;

        for (auto& voice : m_voices) {
            if (!voice.active) continue;
            float s = generate_sample(voice, dt);
            left += s * voice.pan_left;
            right += s * voice.pan_right;
        }

        output_buffer[i * 2 + 0] = left;
        output_buffer[i * 2 + 1] = right;
    }

    // Cleanup finished voices
    m_voices.erase(
        std::remove_if(m_voices.begin(), m_voices.end(), [](const ActiveVoice& v) { return !v.active; }),
        m_voices.end()
    );
}

} // namespace engine::audio
