#pragma once

#include "gl_loader.h"
#include <string>
#include <unordered_map>
#include <glm/glm.hpp>

namespace engine::renderer {

class Shader {
public:
    Shader();
    ~Shader();

    bool load_from_source(const std::string& vertex_src, const std::string& fragment_src);
    void use() const;
    void unbind() const;

    GLuint program_id() const { return m_program; }
    bool is_valid() const { return m_program != 0; }

    void set_bool(const std::string& name, bool value);
    void set_int(const std::string& name, int value);
    void set_float(const std::string& name, float value);
    void set_vec2(const std::string& name, const glm::vec2& value);
    void set_vec3(const std::string& name, const glm::vec3& value);
    void set_vec4(const std::string& name, const glm::vec4& value);
    void set_mat3(const std::string& name, const glm::mat3& value);
    void set_mat4(const std::string& name, const glm::mat4& value);

private:
    GLint get_uniform_location(const std::string& name);
    GLuint compile_shader(GLenum type, const std::string& source);

    GLuint m_program{0};
    std::unordered_map<std::string, GLint> m_uniform_cache;
};

} // namespace engine::renderer
