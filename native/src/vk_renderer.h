// IRON HORIZON — Vulkan renderer (native port)
#pragma once

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/glm.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

struct MeshData {
    std::vector<float> vertices;        // pos(3) + color(3) per vertex
    std::vector<uint32_t> indices;
};

struct DrawItem {
    uint32_t firstIndex;
    uint32_t indexCount;
    int32_t  vertexOffset;
    glm::mat4 mvp;
};

class VulkanRenderer {
public:
    void init(GLFWwindow* window);
    void uploadMesh(const MeshData& mesh);   // appends; draw via returned offsets
    uint64_t vertexBase() const { return stagingVerts_.size() / 6; }
    uint64_t indexBase() const { return stagingIndices_.size(); }
    void drawFrame(const std::vector<DrawItem>& items);
    void waitIdle();
    void cleanup();

    bool frameTimeout = false;               // true when swapchain suboptimal/out-of-date

private:
    struct QueueFamilies {
        std::optional<uint32_t> graphics;
        std::optional<uint32_t> present;
        bool complete() const { return graphics.has_value() && present.has_value(); }
    };

    GLFWwindow* window_ = nullptr;
    VkInstance instance_ = VK_NULL_HANDLE;
    VkSurfaceKHR surface_ = VK_NULL_HANDLE;
    VkPhysicalDevice physical_ = VK_NULL_HANDLE;
    VkDevice device_ = VK_NULL_HANDLE;
    VkQueue graphicsQueue_ = VK_NULL_HANDLE;
    VkQueue presentQueue_ = VK_NULL_HANDLE;
    uint32_t graphicsFamily_ = 0;
    uint32_t presentFamily_ = 0;

    VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
    VkFormat swapchainFormat_ = VK_FORMAT_UNDEFINED;
    VkExtent2D swapchainExtent_{};
    std::vector<VkImage> swapchainImages_;
    std::vector<VkImageView> swapchainViews_;
    std::vector<VkFramebuffer> framebuffers_;

    VkRenderPass renderPass_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    VkCommandPool commandPool_ = VK_NULL_HANDLE;
    std::vector<VkCommandBuffer> commandBuffers_;

    VkImage depthImage_ = VK_NULL_HANDLE;
    VkDeviceMemory depthMemory_ = VK_NULL_HANDLE;
    VkImageView depthView_ = VK_NULL_HANDLE;

    VkBuffer vertexBuffer_ = VK_NULL_HANDLE;
    VkDeviceMemory vertexMemory_ = VK_NULL_HANDLE;
    VkBuffer indexBuffer_ = VK_NULL_HANDLE;
    VkDeviceMemory indexMemory_ = VK_NULL_HANDLE;
    uint64_t vertexCapacity_ = 0;
    uint64_t indexCapacity_ = 0;
    std::vector<float> stagingVerts_;    // all uploaded meshes, appended
    std::vector<uint32_t> stagingIndices_;

    static constexpr size_t MAX_FRAMES = 2;
    std::vector<VkSemaphore> imageAvailable_;
    std::vector<VkSemaphore> renderDone_;
    std::vector<VkFence> inFlight_;
    size_t currentFrame_ = 0;

    void createInstance();
    void createSurface();
    void pickPhysicalDevice();
    void createLogicalDevice();
    void createSwapchain();
    void createDepthResources();
    void createRenderPass();
    void createPipeline();
    void createFramebuffers();
    void createCommandPoolAndBuffers();
    void createSyncObjects();
    void recreateSwapchain();
    void cleanupSwapchain();
    void ensureBufferCapacity(VkBuffer& buffer, VkDeviceMemory& memory,
                              uint64_t& capacity, VkBufferUsageFlags usage,
                              uint64_t requiredBytes);
    QueueFamilies findQueueFamilies(VkPhysicalDevice device) const;
    uint32_t findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags properties) const;
    static std::vector<char> readFile(const std::string& path);
};
