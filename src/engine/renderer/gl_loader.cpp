#include "gl_loader.h"

#if !defined(__EMSCRIPTEN__)
#include "../core/logger.h"
#include <SDL2/SDL.h>

PFNGLGENVERTEXARRAYSPROC glGenVertexArrays = nullptr;
PFNGLBINDVERTEXARRAYPROC glBindVertexArray = nullptr;
PFNGLDELETEVERTEXARRAYSPROC glDeleteVertexArrays = nullptr;
PFNGLGENBUFFERSPROC glGenBuffers = nullptr;
PFNGLBINDBUFFERPROC glBindBuffer = nullptr;
PFNGLBUFFERDATAPROC glBufferData = nullptr;
PFNGLBUFFERSUBDATAPROC glBufferSubData = nullptr;
PFNGLDELETEBUFFERSPROC glDeleteBuffers = nullptr;
PFNGLENABLEVERTEXATTRIBARRAYPROC glEnableVertexAttribArray = nullptr;
PFNGLDISABLEVERTEXATTRIBARRAYPROC glDisableVertexAttribArray = nullptr;
PFNGLVERTEXATTRIBPOINTERPROC glVertexAttribPointer = nullptr;
PFNGLVERTEXATTRIBIPOINTERPROC glVertexAttribIPointer = nullptr;
PFNGLVERTEXATTRIBDIVISORPROC glVertexAttribDivisor = nullptr;

PFNGLCREATESHADERPROC glCreateShader = nullptr;
PFNGLSHADERSOURCEPROC glShaderSource = nullptr;
PFNGLCOMPILESHADERPROC glCompileShader = nullptr;
PFNGLGETSHADERIVPROC glGetShaderiv = nullptr;
PFNGLGETSHADERINFOLOGPROC glGetShaderInfoLog = nullptr;
PFNGLDELETESHADERPROC glDeleteShader = nullptr;

PFNGLCREATEPROGRAMPROC glCreateProgram = nullptr;
PFNGLATTACHSHADERPROC glAttachShader = nullptr;
PFNGLDETACHSHADERPROC glDetachShader = nullptr;
PFNGLLINKPROGRAMPROC glLinkProgram = nullptr;
PFNGLUSEPROGRAMPROC glUseProgram = nullptr;
PFNGLGETPROGRAMIVPROC glGetProgramiv = nullptr;
PFNGLGETPROGRAMINFOLOGPROC glGetProgramInfoLog = nullptr;
PFNGLDELETEPROGRAMPROC glDeleteProgram = nullptr;

PFNGLGETUNIFORMLOCATIONPROC glGetUniformLocation = nullptr;
PFNGLUNIFORM1IPROC glUniform1i = nullptr;
PFNGLUNIFORM1FPROC glUniform1f = nullptr;
PFNGLUNIFORM2FPROC glUniform2f = nullptr;
PFNGLUNIFORM3FPROC glUniform3f = nullptr;
PFNGLUNIFORM4FPROC glUniform4f = nullptr;
PFNGLUNIFORM1FVPROC glUniform1fv = nullptr;
PFNGLUNIFORM2FVPROC glUniform2fv = nullptr;
PFNGLUNIFORM3FVPROC glUniform3fv = nullptr;
PFNGLUNIFORM4FVPROC glUniform4fv = nullptr;
PFNGLUNIFORMMATRIX3FVPROC glUniformMatrix3fv = nullptr;
PFNGLUNIFORMMATRIX4FVPROC glUniformMatrix4fv = nullptr;

PFNGLGENERATEMIPMAPPROC glGenerateMipmap = nullptr;

PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers = nullptr;
PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer = nullptr;
PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D = nullptr;
PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus = nullptr;
PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers = nullptr;

PFNGLGENRENDERBUFFERSPROC glGenRenderbuffers = nullptr;
PFNGLBINDRENDERBUFFERPROC glBindRenderbuffer = nullptr;
PFNGLRENDERBUFFERSTORAGEPROC glRenderbufferStorage = nullptr;
PFNGLFRAMEBUFFERRENDERBUFFERPROC glFramebufferRenderbuffer = nullptr;
PFNGLDELETERENDERBUFFERSPROC glDeleteRenderbuffers = nullptr;
PFNGLDRAWBUFFERSPROC glDrawBuffers = nullptr;
PFNGLBLITFRAMEBUFFERPROC glBlitFramebuffer = nullptr;

namespace engine::renderer {

template <typename T>
static bool load_proc(T& proc, const char* name) {
    proc = reinterpret_cast<T>(SDL_GL_GetProcAddress(name));
    if (!proc) {
        core::Logger::error("GL", std::string("Failed to load GL function: ") + name);
        return false;
    }
    return true;
}

bool init_gl_loader() {
    bool ok = true;
    ok &= load_proc(glGenVertexArrays, "glGenVertexArrays");
    ok &= load_proc(glBindVertexArray, "glBindVertexArray");
    ok &= load_proc(glDeleteVertexArrays, "glDeleteVertexArrays");
    ok &= load_proc(glGenBuffers, "glGenBuffers");
    ok &= load_proc(glBindBuffer, "glBindBuffer");
    ok &= load_proc(glBufferData, "glBufferData");
    ok &= load_proc(glBufferSubData, "glBufferSubData");
    ok &= load_proc(glDeleteBuffers, "glDeleteBuffers");
    ok &= load_proc(glEnableVertexAttribArray, "glEnableVertexAttribArray");
    ok &= load_proc(glDisableVertexAttribArray, "glDisableVertexAttribArray");
    ok &= load_proc(glVertexAttribPointer, "glVertexAttribPointer");
    ok &= load_proc(glVertexAttribIPointer, "glVertexAttribIPointer");
    ok &= load_proc(glVertexAttribDivisor, "glVertexAttribDivisor");

    ok &= load_proc(glCreateShader, "glCreateShader");
    ok &= load_proc(glShaderSource, "glShaderSource");
    ok &= load_proc(glCompileShader, "glCompileShader");
    ok &= load_proc(glGetShaderiv, "glGetShaderiv");
    ok &= load_proc(glGetShaderInfoLog, "glGetShaderInfoLog");
    ok &= load_proc(glDeleteShader, "glDeleteShader");

    ok &= load_proc(glCreateProgram, "glCreateProgram");
    ok &= load_proc(glAttachShader, "glAttachShader");
    ok &= load_proc(glDetachShader, "glDetachShader");
    ok &= load_proc(glLinkProgram, "glLinkProgram");
    ok &= load_proc(glUseProgram, "glUseProgram");
    ok &= load_proc(glGetProgramiv, "glGetProgramiv");
    ok &= load_proc(glGetProgramInfoLog, "glGetProgramInfoLog");
    ok &= load_proc(glDeleteProgram, "glDeleteProgram");

    ok &= load_proc(glGetUniformLocation, "glGetUniformLocation");
    ok &= load_proc(glUniform1i, "glUniform1i");
    ok &= load_proc(glUniform1f, "glUniform1f");
    ok &= load_proc(glUniform2f, "glUniform2f");
    ok &= load_proc(glUniform3f, "glUniform3f");
    ok &= load_proc(glUniform4f, "glUniform4f");
    ok &= load_proc(glUniform1fv, "glUniform1fv");
    ok &= load_proc(glUniform2fv, "glUniform2fv");
    ok &= load_proc(glUniform3fv, "glUniform3fv");
    ok &= load_proc(glUniform4fv, "glUniform4fv");
    ok &= load_proc(glUniformMatrix3fv, "glUniformMatrix3fv");
    ok &= load_proc(glUniformMatrix4fv, "glUniformMatrix4fv");

    ok &= load_proc(glGenerateMipmap, "glGenerateMipmap");

    ok &= load_proc(glGenFramebuffers, "glGenFramebuffers");
    ok &= load_proc(glBindFramebuffer, "glBindFramebuffer");
    ok &= load_proc(glFramebufferTexture2D, "glFramebufferTexture2D");
    ok &= load_proc(glCheckFramebufferStatus, "glCheckFramebufferStatus");
    ok &= load_proc(glDeleteFramebuffers, "glDeleteFramebuffers");

    ok &= load_proc(glGenRenderbuffers, "glGenRenderbuffers");
    ok &= load_proc(glBindRenderbuffer, "glBindRenderbuffer");
    ok &= load_proc(glRenderbufferStorage, "glRenderbufferStorage");
    ok &= load_proc(glFramebufferRenderbuffer, "glFramebufferRenderbuffer");
    ok &= load_proc(glDeleteRenderbuffers, "glDeleteRenderbuffers");
    ok &= load_proc(glDrawBuffers, "glDrawBuffers");
    ok &= load_proc(glBlitFramebuffer, "glBlitFramebuffer");

    if (ok) {
        core::Logger::info("GL", "OpenGL 3.3 Core / GLES 3.0 functions dynamically loaded successfully");
    } else {
        core::Logger::warn("GL", "Some modern OpenGL functions could not be loaded");
    }
    return ok;
}

} // namespace engine::renderer
#endif
