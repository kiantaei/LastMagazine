#pragma once

#if defined(__EMSCRIPTEN__)
    #include <GLES3/gl3.h>
    #include <GLES2/gl2ext.h>
    namespace engine::renderer {
        inline bool init_gl_loader() { return true; }
    }
#else
    #define NO_SDL_GLEXT 1
    #include <SDL2/SDL_opengl.h>
    #include <SDL2/SDL_opengl_glext.h>

    namespace engine::renderer {
        bool init_gl_loader();
    }

    // Function pointer declarations for desktop dynamic loading via SDL_GL_GetProcAddress
    extern PFNGLGENVERTEXARRAYSPROC glGenVertexArrays;
    extern PFNGLBINDVERTEXARRAYPROC glBindVertexArray;
    extern PFNGLDELETEVERTEXARRAYSPROC glDeleteVertexArrays;
    extern PFNGLGENBUFFERSPROC glGenBuffers;
    extern PFNGLBINDBUFFERPROC glBindBuffer;
    extern PFNGLBUFFERDATAPROC glBufferData;
    extern PFNGLBUFFERSUBDATAPROC glBufferSubData;
    extern PFNGLDELETEBUFFERSPROC glDeleteBuffers;
    extern PFNGLENABLEVERTEXATTRIBARRAYPROC glEnableVertexAttribArray;
    extern PFNGLDISABLEVERTEXATTRIBARRAYPROC glDisableVertexAttribArray;
    extern PFNGLVERTEXATTRIBPOINTERPROC glVertexAttribPointer;
    extern PFNGLVERTEXATTRIBIPOINTERPROC glVertexAttribIPointer;
    extern PFNGLVERTEXATTRIBDIVISORPROC glVertexAttribDivisor;

    extern PFNGLCREATESHADERPROC glCreateShader;
    extern PFNGLSHADERSOURCEPROC glShaderSource;
    extern PFNGLCOMPILESHADERPROC glCompileShader;
    extern PFNGLGETSHADERIVPROC glGetShaderiv;
    extern PFNGLGETSHADERINFOLOGPROC glGetShaderInfoLog;
    extern PFNGLDELETESHADERPROC glDeleteShader;

    extern PFNGLCREATEPROGRAMPROC glCreateProgram;
    extern PFNGLATTACHSHADERPROC glAttachShader;
    extern PFNGLDETACHSHADERPROC glDetachShader;
    extern PFNGLLINKPROGRAMPROC glLinkProgram;
    extern PFNGLUSEPROGRAMPROC glUseProgram;
    extern PFNGLGETPROGRAMIVPROC glGetProgramiv;
    extern PFNGLGETPROGRAMINFOLOGPROC glGetProgramInfoLog;
    extern PFNGLDELETEPROGRAMPROC glDeleteProgram;

    extern PFNGLGETUNIFORMLOCATIONPROC glGetUniformLocation;
    extern PFNGLUNIFORM1IPROC glUniform1i;
    extern PFNGLUNIFORM1FPROC glUniform1f;
    extern PFNGLUNIFORM2FPROC glUniform2f;
    extern PFNGLUNIFORM3FPROC glUniform3f;
    extern PFNGLUNIFORM4FPROC glUniform4f;
    extern PFNGLUNIFORM1FVPROC glUniform1fv;
    extern PFNGLUNIFORM2FVPROC glUniform2fv;
    extern PFNGLUNIFORM3FVPROC glUniform3fv;
    extern PFNGLUNIFORM4FVPROC glUniform4fv;
    extern PFNGLUNIFORMMATRIX3FVPROC glUniformMatrix3fv;
    extern PFNGLUNIFORMMATRIX4FVPROC glUniformMatrix4fv;

    extern PFNGLGENERATEMIPMAPPROC glGenerateMipmap;

    extern PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers;
    extern PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer;
    extern PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D;
    extern PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus;
    extern PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers;

    extern PFNGLGENRENDERBUFFERSPROC glGenRenderbuffers;
    extern PFNGLBINDRENDERBUFFERPROC glBindRenderbuffer;
    extern PFNGLRENDERBUFFERSTORAGEPROC glRenderbufferStorage;
    extern PFNGLFRAMEBUFFERRENDERBUFFERPROC glFramebufferRenderbuffer;
    extern PFNGLDELETERENDERBUFFERSPROC glDeleteRenderbuffers;
    extern PFNGLDRAWBUFFERSPROC glDrawBuffers;
    extern PFNGLBLITFRAMEBUFFERPROC glBlitFramebuffer;
#endif
