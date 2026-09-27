cmake_minimum_required(VERSION 3.16)
project(metrics_console CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(SMARTSPECTRA_ROOT "/opt/smartspectra")

find_package(OpenCV REQUIRED)
find_package(absl REQUIRED)

include_directories(
    ${SMARTSPECTRA_ROOT}/include
    ${SMARTSPECTRA_ROOT}/include/smartspectra/interface
    ${OpenCV_INCLUDE_DIRS}
)

link_directories(
    ${SMARTSPECTRA_ROOT}/lib
)

add_executable(metrics_console main.cpp)

target_link_libraries(metrics_console PRIVATE
    ${OpenCV_LIBS}
    smartspectra
    absl::flags
    absl::flags_parse
)