#include "vk_renderer.h"

#include <iostream>
#include <stdexcept>
#include <cstring>
#include <fstream>
#include <array>

#ifdef _WIN32
static const char* SHADER_DIR = "shaders\\";
#else
static const char* SHADER_DIR = "shaders/";
#endif

static VkBool32 debugCallback(VkDebugUtilsMessageSeverityFlagBitsEXT,
                              VkDebugUtilsMessageTypeFlagsEXT,
                              const VkDebugUtilsMessengerCallbackDataEXT* data,
                              void*) {
    std::cerr << "[vulkan] " << data->pMessage << '\n';
    return VK_FALSE;
}

void VulkanRenderer::init(GLFWwindow* window) {
    window_ = window;
    createInstance();
    createSurface();
    pickPhysicalDevice();
    createLogicalDevice();
    createSwapchain();
    createRenderPass();
    createDepthResources();
    createFramebuffers();
    createPipeline();
    createCommandPoolAndBuffers();
    createSyncObjects();
}

void VulkanRenderer::createInstance() {
    VkApplicationInfo app{};
    app.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app.pApplicationName = "IRON HORIZON";
    app.applicationVersion = VK_MAKE_VERSION(2, 0, 0);
    app.pEngineName = "IronEngine";
    app.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    app.apiVersion = VK_API_VERSION_1_1;

    uint32_t count = 0;
    const char** extensions = glfwGetRequiredInstanceExtensions(&count);
    std::vector<const char*> exts(extensions, extensions + count);

    VkInstanceCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    ci.pApplicationInfo = &app;
    ci.enabledExtensionCount = static_cast<uint32_t>(exts.size());
    ci.ppEnabledExtensionNames = exts.data();

    if (vkCreateInstance(&ci, nullptr, &instance_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateInstance failed");
}

void VulkanRenderer::createSurface() {
    if (glfwCreateWindowSurface(instance_, window_, nullptr, &surface_) != VK_SUCCESS)
        throw std::runtime_error("glfwCreateWindowSurface failed");
}

VulkanRenderer::QueueFamilies VulkanRenderer::findQueueFamilies(VkPhysicalDevice device) const {
    QueueFamilies out;
    uint32_t n = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(device, &n, nullptr);
    std::vector<VkQueueFamilyProperties> props(n);
    vkGetPhysicalDeviceQueueFamilyProperties(device, &n, props.data());
    for (uint32_t i = 0; i < n; ++i) {
        if (props[i].queueFlags & VK_QUEUE_GRAPHICS_BIT)
            if (!out.graphics) out.graphics = i;
        VkBool32 present = VK_FALSE;
        vkGetPhysicalDeviceSurfaceSupportKHR(device, i, surface_, &present);
        if (present && !out.present) out.present = i;
        if (out.complete()) break;
    }
    return out;
}

void VulkanRenderer::pickPhysicalDevice() {
    uint32_t n = 0;
    vkEnumeratePhysicalDevices(instance_, &n, nullptr);
    if (n == 0) throw std::runtime_error("no Vulkan-capable GPU found");
    std::vector<VkPhysicalDevice> devices(n);
    vkEnumeratePhysicalDevices(instance_, &n, devices.data());

    // Prefer a discrete GPU, fall back to the first graphics-capable device
    for (VkPhysicalDevice d : devices) {
        auto fam = findQueueFamilies(d);
        if (!fam.complete()) continue;
        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(d, &props);
        if (!physical_ || props.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU)
            physical_ = d;
        if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) break;
    }
    if (!physical_) throw std::runtime_error("no suitable GPU device");

    auto fam = findQueueFamilies(physical_);
    graphicsFamily_ = *fam.graphics;
    presentFamily_ = *fam.present;
}

void VulkanRenderer::createLogicalDevice() {
    float prio = 1.0f;
    std::vector<VkDeviceQueueCreateInfo> queues;
    for (uint32_t family : {graphicsFamily_, presentFamily_}) {
        VkDeviceQueueCreateInfo q{};
        q.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        q.queueFamilyIndex = family;
        q.queueCount = 1;
        q.pQueuePriorities = &prio;
        if (queues.empty() || queues.back().queueFamilyIndex != family)
            queues.push_back(q);
    }

    VkPhysicalDeviceFeatures features{};
    VkDeviceCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    ci.queueCreateInfoCount = static_cast<uint32_t>(queues.size());
    ci.pQueueCreateInfos = queues.data();
    ci.pEnabledFeatures = &features;
    ci.enabledExtensionCount = 1;
    const char* swapExt = VK_KHR_SWAPCHAIN_EXTENSION_NAME;
    ci.ppEnabledExtensionNames = &swapExt;
    if (vkCreateDevice(physical_, &ci, nullptr, &device_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateDevice failed");
    vkGetDeviceQueue(device_, graphicsFamily_, 0, &graphicsQueue_);
    vkGetDeviceQueue(device_, presentFamily_, 0, &presentQueue_);
}

void VulkanRenderer::createSwapchain() {
    VkSurfaceCapabilitiesKHR caps;
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical_, surface_, &caps);

    uint32_t n = 0;
    vkGetPhysicalDeviceSurfaceFormatsKHR(physical_, surface_, &n, nullptr);
    std::vector<VkSurfaceFormatKHR> formats(n);
    vkGetPhysicalDeviceSurfaceFormatsKHR(physical_, surface_, &n, formats.data());
    swapchainFormat_ = formats[0].format;
    for (auto& f : formats)
        if (f.format == VK_FORMAT_B8G8R8A8_SRGB && f.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR)
            swapchainFormat_ = f.format;

    swapchainExtent_ = caps.currentExtent;
    if (swapchainExtent_.width == UINT32_MAX) {
        int w, h;
        glfwGetFramebufferSize(window_, &w, &h);
        swapchainExtent_.width = std::max(caps.minImageExtent.width, std::min(caps.maxImageExtent.width, static_cast<uint32_t>(w)));
        swapchainExtent_.height = std::max(caps.minImageExtent.height, std::min(caps.maxImageExtent.height, static_cast<uint32_t>(h)));
    }

    uint32_t imageCount = caps.minImageCount + 1;
    if (caps.maxImageCount > 0 && imageCount > caps.maxImageCount) imageCount = caps.maxImageCount;

    VkSwapchainCreateInfoKHR ci{};
    ci.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    ci.surface = surface_;
    ci.minImageCount = imageCount;
    ci.imageFormat = swapchainFormat_;
    ci.imageColorSpace = formats[0].colorSpace;
    ci.imageExtent = swapchainExtent_;
    ci.imageArrayLayers = 1;
    ci.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    uint32_t families[] = {graphicsFamily_, presentFamily_};
    if (graphicsFamily_ != presentFamily_) {
        ci.imageSharingMode = VK_SHARING_MODE_CONCURRENT;
        ci.queueFamilyIndexCount = 2;
        ci.pQueueFamilyIndices = families;
    } else {
        ci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    }
    ci.preTransform = caps.currentTransform;
    ci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    ci.presentMode = VK_PRESENT_MODE_FIFO_KHR;  // vsync: tear-free and always available
    ci.clipped = VK_TRUE;

    if (vkCreateSwapchainKHR(device_, &ci, nullptr, &swapchain_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateSwapchainKHR failed");

    vkGetSwapchainImagesKHR(device_, swapchain_, &n, nullptr);
    swapchainImages_.resize(n);
    vkGetSwapchainImagesKHR(device_, swapchain_, &n, swapchainImages_.data());
    swapchainViews_.resize(n);
    for (size_t i = 0; i < n; ++i) {
        VkImageViewCreateInfo vi{};
        vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        vi.image = swapchainImages_[i];
        vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
        vi.format = swapchainFormat_;
        vi.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        if (vkCreateImageView(device_, &vi, nullptr, &swapchainViews_[i]) != VK_SUCCESS)
            throw std::runtime_error("vkCreateImageView failed");
    }
}

void VulkanRenderer::createRenderPass() {
    VkAttachmentDescription color{};
    color.format = swapchainFormat_;
    color.samples = VK_SAMPLE_COUNT_1_BIT;
    color.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    color.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    color.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    color.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    color.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    color.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentDescription depth{};
    depth.format = VK_FORMAT_D32_SFLOAT;
    depth.samples = VK_SAMPLE_COUNT_1_BIT;
    depth.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    depth.storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    depth.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    depth.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    depth.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    depth.finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;

    VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
    VkAttachmentReference depthRef{1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};

    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &colorRef;
    subpass.pDepthStencilAttachment = &depthRef;

    std::array<VkAttachmentDescription, 2> attachments{color, depth};
    VkRenderPassCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    ci.attachmentCount = 2;
    ci.pAttachments = attachments.data();
    ci.subpassCount = 1;
    ci.pSubpasses = &subpass;
    ci.dependencyCount = 0;
    if (vkCreateRenderPass(device_, &ci, nullptr, &renderPass_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateRenderPass failed");
}

void VulkanRenderer::createDepthResources() {
    VkImageCreateInfo ii{};
    ii.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    ii.imageType = VK_IMAGE_TYPE_2D;
    ii.format = VK_FORMAT_D32_SFLOAT;
    ii.extent = {swapchainExtent_.width, swapchainExtent_.height, 1};
    ii.mipLevels = 1;
    ii.arrayLayers = 1;
    ii.samples = VK_SAMPLE_COUNT_1_BIT;
    ii.tiling = VK_IMAGE_TILING_OPTIMAL;
    ii.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT;
    if (vkCreateImage(device_, &ii, nullptr, &depthImage_) != VK_SUCCESS)
        throw std::runtime_error("depth image failed");

    VkMemoryRequirements req;
    vkGetImageMemoryRequirements(device_, depthImage_, &req);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = findMemoryType(req.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
    if (vkAllocateMemory(device_, &ai, nullptr, &depthMemory_) != VK_SUCCESS)
        throw std::runtime_error("depth memory failed");
    vkBindImageMemory(device_, depthImage_, depthMemory_, 0);

    VkImageViewCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    vi.image = depthImage_;
    vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
    vi.format = VK_FORMAT_D32_SFLOAT;
    vi.subresourceRange = {VK_IMAGE_ASPECT_DEPTH_BIT, 0, 1, 0, 1};
    if (vkCreateImageView(device_, &vi, nullptr, &depthView_) != VK_SUCCESS)
        throw std::runtime_error("depth view failed");
}

void VulkanRenderer::createPipeline() {
    auto vert = readFile(std::string(SHADER_DIR) + "tri.vert.spv");
    auto frag = readFile(std::string(SHADER_DIR) + "tri.frag.spv");

    auto makeShader = [&](const std::vector<char>& code) {
        VkShaderModuleCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
        ci.codeSize = code.size();
        ci.pCode = reinterpret_cast<const uint32_t*>(code.data());
        VkShaderModule m;
        if (vkCreateShaderModule(device_, &ci, nullptr, &m) != VK_SUCCESS)
            throw std::runtime_error("vkCreateShaderModule failed");
        return m;
    };
    VkShaderModule vm = makeShader(vert);
    VkShaderModule fm = makeShader(frag);

    VkPipelineShaderStageCreateInfo stages[2]{};
    stages[0].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
    stages[0].module = vm;
    stages[0].pName = "main";
    stages[1].sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    stages[1].module = fm;
    stages[1].pName = "main";

    VkVertexInputBindingDescription bind{};
    bind.binding = 0;
    bind.stride = sizeof(float) * 6;
    bind.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;
    VkVertexInputAttributeDescription attrs[2] = {
        {0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0},
        {1, 0, VK_FORMAT_R32G32B32_SFLOAT, sizeof(float) * 3},
    };
    VkPipelineVertexInputStateCreateInfo vi{};
    vi.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vi.vertexBindingDescriptionCount = 1;
    vi.pVertexBindingDescriptions = &bind;
    vi.vertexAttributeDescriptionCount = 2;
    vi.pVertexAttributeDescriptions = attrs;

    VkPipelineInputAssemblyStateCreateInfo ia{};
    ia.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    ia.topology = VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST;

    VkPipelineViewportStateCreateInfo vp{};
    vp.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    vp.viewportCount = 1;
    vp.scissorCount = 1;

    VkPipelineRasterizationStateCreateInfo rs{};
    rs.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rs.polygonMode = VK_POLYGON_MODE_FILL;
    rs.cullMode = VK_CULL_MODE_NONE;  // terrain + craft seen from both sides
    rs.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    rs.lineWidth = 1.0f;

    VkPipelineMultisampleStateCreateInfo ms{};
    ms.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    ms.rasterizationSamples = VK_SAMPLE_COUNT_1_BIT;

    VkPipelineDepthStencilStateCreateInfo ds{};
    ds.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    ds.depthTestEnable = VK_TRUE;
    ds.depthWriteEnable = VK_TRUE;
    ds.depthCompareOp = VK_COMPARE_OP_LESS;

    VkPipelineColorBlendAttachmentState blend{};
    blend.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                           VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    VkPipelineColorBlendStateCreateInfo cb{};
    cb.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    cb.attachmentCount = 1;
    cb.pAttachments = &blend;

    VkDynamicState dynStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
    VkPipelineDynamicStateCreateInfo dyn{};
    dyn.sType = VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO;
    dyn.dynamicStateCount = 2;
    dyn.pDynamicStates = dynStates;

    VkPushConstantRange pcRange{};
    pcRange.stageFlags = VK_SHADER_STAGE_VERTEX_BIT;
    pcRange.offset = 0;
    pcRange.size = sizeof(glm::mat4);
    VkPipelineLayoutCreateInfo li{};
    li.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    li.pushConstantRangeCount = 1;
    li.pPushConstantRanges = &pcRange;
    if (vkCreatePipelineLayout(device_, &li, nullptr, &pipelineLayout_) != VK_SUCCESS)
        throw std::runtime_error("vkCreatePipelineLayout failed");

    VkGraphicsPipelineCreateInfo ci{};
    ci.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    ci.stageCount = 2;
    ci.pStages = stages;
    ci.pVertexInputState = &vi;
    ci.pInputAssemblyState = &ia;
    ci.pViewportState = &vp;
    ci.pRasterizationState = &rs;
    ci.pMultisampleState = &ms;
    ci.pDepthStencilState = &ds;
    ci.pColorBlendState = &cb;
    ci.pDynamicState = &dyn;
    ci.layout = pipelineLayout_;
    ci.renderPass = renderPass_;
    if (vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &ci, nullptr, &pipeline_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateGraphicsPipelines failed");

    vkDestroyShaderModule(device_, vm, nullptr);
    vkDestroyShaderModule(device_, fm, nullptr);
}

void VulkanRenderer::createFramebuffers() {
    framebuffers_.resize(swapchainViews_.size());
    for (size_t i = 0; i < framebuffers_.size(); ++i) {
        VkImageView views[] = {swapchainViews_[i], depthView_};
        VkFramebufferCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        ci.renderPass = renderPass_;
        ci.attachmentCount = 2;
        ci.pAttachments = views;
        ci.width = swapchainExtent_.width;
        ci.height = swapchainExtent_.height;
        ci.layers = 1;
        if (vkCreateFramebuffer(device_, &ci, nullptr, &framebuffers_[i]) != VK_SUCCESS)
            throw std::runtime_error("vkCreateFramebuffer failed");
    }
}

void VulkanRenderer::createCommandPoolAndBuffers() {
    VkCommandPoolCreateInfo pi{};
    pi.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pi.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pi.queueFamilyIndex = graphicsFamily_;
    if (vkCreateCommandPool(device_, &pi, nullptr, &commandPool_) != VK_SUCCESS)
        throw std::runtime_error("vkCreateCommandPool failed");

    commandBuffers_.resize(MAX_FRAMES);
    VkCommandBufferAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    ai.commandPool = commandPool_;
    ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    ai.commandBufferCount = MAX_FRAMES;
    if (vkAllocateCommandBuffers(device_, &ai, commandBuffers_.data()) != VK_SUCCESS)
        throw std::runtime_error("vkAllocateCommandBuffers failed");
}

void VulkanRenderer::createSyncObjects() {
    imageAvailable_.resize(MAX_FRAMES);
    renderDone_.resize(MAX_FRAMES);
    inFlight_.resize(MAX_FRAMES);
    for (size_t i = 0; i < MAX_FRAMES; ++i) {
        VkSemaphoreCreateInfo si{};
        si.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;
        vkCreateSemaphore(device_, &si, nullptr, &imageAvailable_[i]);
        vkCreateSemaphore(device_, &si, nullptr, &renderDone_[i]);
        VkFenceCreateInfo fi{};
        fi.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        fi.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        vkCreateFence(device_, &fi, nullptr, &inFlight_[i]);
    }
}

void VulkanRenderer::ensureBufferCapacity(VkBuffer& buffer, VkDeviceMemory& memory,
                                          uint64_t& capacity, VkBufferUsageFlags usage,
                                          uint64_t requiredBytes) {
    if (capacity >= requiredBytes) return;
    if (buffer) { vkDestroyBuffer(device_, buffer, nullptr); vkFreeMemory(device_, memory, nullptr); }
    capacity = requiredBytes * 2;

    VkBufferCreateInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bi.size = capacity;
    bi.usage = usage;
    bi.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    if (vkCreateBuffer(device_, &bi, nullptr, &buffer) != VK_SUCCESS)
        throw std::runtime_error("vkCreateBuffer failed");

    VkMemoryRequirements req;
    vkGetBufferMemoryRequirements(device_, buffer, &req);
    VkMemoryAllocateInfo ai{};
    ai.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    ai.allocationSize = req.size;
    ai.memoryTypeIndex = findMemoryType(req.memoryTypeBits,
        VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    if (vkAllocateMemory(device_, &ai, nullptr, &memory) != VK_SUCCESS)
        throw std::runtime_error("vkAllocateMemory failed");
    vkBindBufferMemory(device_, buffer, memory, 0);
}

void VulkanRenderer::uploadMesh(const MeshData& mesh) {
    // Append into shared GPU buffers so every uploaded mesh stays resident;
    // main.cpp draws each with the offsets from vertexBase()/indexBase()
    uint32_t vBase = static_cast<uint32_t>(stagingVerts_.size() / 6);
    stagingVerts_.insert(stagingVerts_.end(), mesh.vertices.begin(), mesh.vertices.end());
    stagingIndices_.reserve(stagingIndices_.size() + mesh.indices.size());
    for (uint32_t idx : mesh.indices) stagingIndices_.push_back(idx + vBase);

    uint64_t vBytes = stagingVerts_.size() * sizeof(float);
    uint64_t iBytes = stagingIndices_.size() * sizeof(uint32_t);
    ensureBufferCapacity(vertexBuffer_, vertexMemory_, vertexCapacity_,
                         VK_BUFFER_USAGE_VERTEX_BUFFER_BIT, vBytes);
    ensureBufferCapacity(indexBuffer_, indexMemory_, indexCapacity_,
                         VK_BUFFER_USAGE_INDEX_BUFFER_BIT, iBytes);

    void* dst = nullptr;
    vkMapMemory(device_, vertexMemory_, 0, vBytes, 0, &dst);
    std::memcpy(dst, stagingVerts_.data(), vBytes);
    vkUnmapMemory(device_, vertexMemory_);
    vkMapMemory(device_, indexMemory_, 0, iBytes, 0, &dst);
    std::memcpy(dst, stagingIndices_.data(), iBytes);
    vkUnmapMemory(device_, indexMemory_);
}

void VulkanRenderer::recreateSwapchain() {
    int w = 0, h = 0;
    glfwGetFramebufferSize(window_, &w, &h);
    while (w == 0 || h == 0) {
        glfwGetFramebufferSize(window_, &w, &h);
        glfwWaitEvents();
    }
    vkDeviceWaitIdle(device_);
    cleanupSwapchain();
    createSwapchain();
    createDepthResources();
    createFramebuffers();
}

void VulkanRenderer::cleanupSwapchain() {
    for (auto fb : framebuffers_) vkDestroyFramebuffer(device_, fb, nullptr);
    framebuffers_.clear();
    vkDestroyImageView(device_, depthView_, nullptr);
    vkDestroyImage(device_, depthImage_, nullptr);
    vkFreeMemory(device_, depthMemory_, nullptr);
    for (auto v : swapchainViews_) vkDestroyImageView(device_, v, nullptr);
    swapchainViews_.clear();
    vkDestroySwapchainKHR(device_, swapchain_, nullptr);
    swapchainImages_.clear();
}

void VulkanRenderer::drawFrame(const std::vector<DrawItem>& items) {
    vkWaitForFences(device_, 1, &inFlight_[currentFrame_], VK_TRUE, UINT64_MAX);

    uint32_t imageIndex = 0;
    VkResult acquire = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX,
                                             imageAvailable_[currentFrame_], VK_NULL_HANDLE, &imageIndex);
    if (acquire == VK_ERROR_OUT_OF_DATE_KHR) {
        recreateSwapchain();
        frameTimeout = true;
        return;
    }
    if (acquire != VK_SUCCESS && acquire != VK_SUBOPTIMAL_KHR)
        throw std::runtime_error("vkAcquireNextImageKHR failed");

    vkResetFences(device_, 1, &inFlight_[currentFrame_]);

    VkCommandBuffer cmd = commandBuffers_[currentFrame_];
    vkResetCommandBuffer(cmd, 0);

    VkCommandBufferBeginInfo bi{};
    bi.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    if (vkBeginCommandBuffer(cmd, &bi) != VK_SUCCESS)
        throw std::runtime_error("vkBeginCommandBuffer failed");

    std::array<VkClearValue, 2> clears{};
    clears[0].color = {{0.55f, 0.65f, 0.76f, 1.0f}};  // high-altitude sky
    clears[1].depthStencil = {1.0f, 0};

    VkRenderPassBeginInfo rp{};
    rp.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rp.renderPass = renderPass_;
    rp.framebuffer = framebuffers_[imageIndex];
    rp.renderArea.extent = swapchainExtent_;
    rp.clearValueCount = 2;
    rp.pClearValues = clears.data();
    vkCmdBeginRenderPass(cmd, &rp, VK_SUBPASS_CONTENTS_INLINE);

    VkViewport viewport{0, 0, static_cast<float>(swapchainExtent_.width),
                        static_cast<float>(swapchainExtent_.height), 0, 1};
    VkRect2D scissor{{0, 0}, swapchainExtent_};
    vkCmdSetViewport(cmd, 0, 1, &viewport);
    vkCmdSetScissor(cmd, 0, 1, &scissor);

    VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &vertexBuffer_, &offset);
    vkCmdBindIndexBuffer(cmd, indexBuffer_, 0, VK_INDEX_TYPE_UINT32);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, pipeline_);

    for (const DrawItem& item : items) {
        vkCmdPushConstants(cmd, pipelineLayout_, VK_SHADER_STAGE_VERTEX_BIT,
                           0, sizeof(glm::mat4), &item.mvp);
        vkCmdDrawIndexed(cmd, item.indexCount, 1, item.firstIndex, item.vertexOffset, 0);
    }

    vkCmdEndRenderPass(cmd);
    if (vkEndCommandBuffer(cmd) != VK_SUCCESS)
        throw std::runtime_error("vkEndCommandBuffer failed");

    VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo si{};
    si.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    si.waitSemaphoreCount = 1;
    si.pWaitSemaphores = &imageAvailable_[currentFrame_];
    si.pWaitDstStageMask = &waitStage;
    si.commandBufferCount = 1;
    si.pCommandBuffers = &cmd;
    si.signalSemaphoreCount = 1;
    si.pSignalSemaphores = &renderDone_[currentFrame_];
    if (vkQueueSubmit(graphicsQueue_, 1, &si, inFlight_[currentFrame_]) != VK_SUCCESS)
        throw std::runtime_error("vkQueueSubmit failed");

    VkPresentInfoKHR pi{};
    pi.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    pi.waitSemaphoreCount = 1;
    pi.pWaitSemaphores = &renderDone_[currentFrame_];
    pi.swapchainCount = 1;
    pi.pSwapchains = &swapchain_;
    pi.pImageIndices = &imageIndex;
    VkResult present = vkQueuePresentKHR(presentQueue_, &pi);
    if (present == VK_ERROR_OUT_OF_DATE_KHR || present == VK_SUBOPTIMAL_KHR) {
        recreateSwapchain();
        frameTimeout = true;
    } else if (present != VK_SUCCESS) {
        throw std::runtime_error("vkQueuePresentKHR failed");
    }

    currentFrame_ = (currentFrame_ + 1) % MAX_FRAMES;
}

void VulkanRenderer::waitIdle() {
    if (device_) vkDeviceWaitIdle(device_);
}

void VulkanRenderer::cleanup() {
    waitIdle();
    cleanupSwapchain();
    vkDestroyBuffer(device_, vertexBuffer_, nullptr);
    vkFreeMemory(device_, vertexMemory_, nullptr);
    vkDestroyBuffer(device_, indexBuffer_, nullptr);
    vkFreeMemory(device_, indexMemory_, nullptr);
    vkDestroyPipeline(device_, pipeline_, nullptr);
    vkDestroyPipelineLayout(device_, pipelineLayout_, nullptr);
    vkDestroyRenderPass(device_, renderPass_, nullptr);
    for (size_t i = 0; i < MAX_FRAMES; ++i) {
        vkDestroySemaphore(device_, imageAvailable_[i], nullptr);
        vkDestroySemaphore(device_, renderDone_[i], nullptr);
        vkDestroyFence(device_, inFlight_[i], nullptr);
    }
    vkDestroyCommandPool(device_, commandPool_, nullptr);
    vkDestroyDevice(device_, nullptr);
    vkDestroySurfaceKHR(instance_, surface_, nullptr);
    vkDestroyInstance(instance_, nullptr);
}

uint32_t VulkanRenderer::findMemoryType(uint32_t typeBits, VkMemoryPropertyFlags properties) const {
    VkPhysicalDeviceMemoryProperties mem;
    vkGetPhysicalDeviceMemoryProperties(physical_, &mem);
    for (uint32_t i = 0; i < mem.memoryTypeCount; ++i)
        if ((typeBits & (1u << i)) &&
            (mem.memoryTypes[i].propertyFlags & properties) == properties)
            return i;
    throw std::runtime_error("no suitable memory type");
}

std::vector<char> VulkanRenderer::readFile(const std::string& path) {
    std::ifstream file(path, std::ios::ate | std::ios::binary);
    if (!file) throw std::runtime_error("cannot open shader: " + path);
    std::vector<char> data(static_cast<size_t>(file.tellg()));
    file.seekg(0);
    file.read(data.data(), static_cast<std::streamsize>(data.size()));
    return data;
}
