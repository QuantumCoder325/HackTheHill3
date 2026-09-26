cmake_minimum_required(VERSION 3.22.1)

project(SmartSpectraMetricsConsole CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(SmartSpectra CONFIG REQUIRED)

add_executable(metrics_console main.cc)

target_link_libraries(metrics_console
    PRIVATE
    SmartSpectra::SDK
)
