cmake_minimum_required(VERSION 3.16)
project(metrics_console CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Define custom install root
set(SMARTSPECTRA_ROOT "/opt/smartspectra")

# Find system packages
find_package(OpenCV REQUIRED)

# Include directories
include_directories(
    ${SMARTSPECTRA_ROOT}/include
    ${SMARTSPECTRA_ROOT}/include/smartspectra/interface
    ${OpenCV_INCLUDE_DIRS}
)

# Link directories
link_directories(
    ${SMARTSPECTRA_ROOT}/lib
)

# Target executable
add_executable(metrics_console main.cpp)

# Link libraries
target_link_libraries(metrics_console PRIVATE
    ${OpenCV_LIBS}
    smartspectra
    absl_flags
    absl_flags_parse
)