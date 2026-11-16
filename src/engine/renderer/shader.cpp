#include "shader.h"
#include "../core/logger.h"
#include <vector>
#include <glm/gtc/type_ptr.hpp>

namespace engine::renderer {

Shader::Shader() = default;

Shader::~Shader() {
    if (m_program != 0) {
        glDeleteProgram(m_program);
        m_program = 0;
    }
}

GLuint Shader::compile_shader(GLenum type, const std::string& source) {
    GLuint shader = glCreateShader(type);

#if defined(__EMSCRIPTEN__)
    std::string preamble = "#version 300 es\nprecision highp float;\nprecision highp int;\n";
#else
    std::string preamble = "#version 330 core\n#define highp \n#define mediump \n#define lowp \n";
#endif

    std::string full_source = preamble + source;
    const char* src_ptr = full_source.c_str();
    glShaderSource(shader, 1, &src_ptr, nullptr);
    glCompileShader(shader);

    GLint success = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
    if (!success) {
        GLint log_length = 0;
        glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &log_length);
        std::vector<char> info_log(log_length > 0 ? log_length : 512);
        glGetShaderInfoLog(shader, static_cast<GLsizei>(info_log.size()), nullptr, info_log.data());

        std::string type_str = (type == GL_VERTEX_SHADER) ? "VERTEX" : "FRAGMENT";
        core::Logger::error("SHADER", type_str + " compile failed: " + std::string(info_log.data()));
        glDeleteShader(shader);
        return 0;
    }

    return shader;
}

bool Shader::load_from_source(const std::string& vertex_src, const std::string& fragment_src) {
    if (m_program != 0) {
        glDeleteProgram(m_program);
        m_program = 0;
        m_uniform_cache.clear();
    }

    GLuint vs = compile_shader(GL_VERTEX_SHADER, vertex_src);
    if (vs == 0) return false;

    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, fragment_src);
    if (fs == 0) {
        glDeleteShader(vs);
        return false;
    }

    m_program = glCreateProgram();
    glAttachShader(m_program, vs);
    glAttachShader(m_program, fs);
    glLinkProgram(m_program);

    GLint success = 0;
    glGetProgramiv(m_program, GL_LINK_STATUS, &success);
    if (!success) {
        GLint log_length = 0;
        glGetProgramiv(m_program, GL_INFO_LOG_LENGTH, &log_length);
        std::vector<char> info_log(log_length > 0 ? log_length : 512);
        glGetProgramInfoLog(m_program, static_cast<GLsizei>(info_log.size()), nullptr, info_log.data());
        core::Logger::error("SHADER", "Program link failed: " + std::string(info_log.data()));

        glDeleteShader(vs);
        glDeleteShader(fs);
        glDeleteProgram(m_program);
        m_program = 0;
        return false;
    }

    glDetachShader(m_program, vs);
    glDetachShader(m_program, fs);
    glDeleteShader(vs);
    glDeleteShader(fs);

    core::Logger::debug("SHADER", "Shader program linked successfully (ID: " + std::to_string(m_program) + ")");
    return true;
}

void Shader::use() const {
    if (m_program != 0) {
        glUseProgram(m_program);
    }
}

void Shader::unbind() const {
    glUseProgram(0);
}

GLint Shader::get_uniform_location(const std::string& name) {
    auto it = m_uniform_cache.find(name);
    if (it != m_uniform_cache.end()) {
        return it->second;
    }
    GLint loc = glGetUniformLocation(m_program, name.c_str());
    m_uniform_cache[name] = loc;
    return loc;
}

void Shader::set_bool(const std::string& name, bool value) {
    glUniform1i(get_uniform_location(name), value ? 1 : 0);
}

void Shader::set_int(const std::string& name, int value) {
    glUniform1i(get_uniform_location(name), value);
}

void Shader::set_float(const std::string& name, float value) {
    glUniform1f(get_uniform_location(name), value);
}

void Shader::set_vec2(const std::string& name, const glm::vec2& value) {
    glUniform2f(get_uniform_location(name), value.x, value.y);
}

void Shader::set_vec3(const std::string& name, const glm::vec3& value) {
    glUniform3f(get_uniform_location(name), value.x, value.y, value.z);
}

void Shader::set_vec4(const std::string& name, const glm::vec4& value) {
    glUniform4f(get_uniform_location(name), value.x, value.y, value.z, value.w);
}

void Shader::set_mat3(const std::string& name, const glm::mat3& value) {
    glUniformMatrix3fv(get_uniform_location(name), 1, GL_FALSE, glm::value_ptr(value));
}

void Shader::set_mat4(const std::string& name, const glm::mat4& value) {
    glUniformMatrix4fv(get_uniform_location(name), 1, GL_FALSE, glm::value_ptr(value));
}

} // namespace engine::renderer
