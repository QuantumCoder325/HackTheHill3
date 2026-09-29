<div align="center">

# VitaSpectra

<p align="center">In emergency situations, first responders need useful patient information as quickly as possible, but collecting vital signs can take time and often requires physical contact, extra equipment, and divided attention. We wanted to explore what would happen if some of that information could be captured passively through a camera and displayed directly in a responder’s field of view.</p>

<p align="center"><a href="https://devpost.com/software/tempname-sfk4wn">Devpost</a></p>


[![Stars](https://img.shields.io/github/stars/QuantumCoder325/HackTheHill3?style=flat-square)](https://github.com/QuantumCoder325/HackTheHill3/stargazers) [![Forks](https://img.shields.io/github/forks/QuantumCoder325/HackTheHill3?style=flat-square)](https://github.com/QuantumCoder325/HackTheHill3/network) [![Issues](https://img.shields.io/github/issues/QuantumCoder325/HackTheHill3?style=flat-square)](https://github.com/QuantumCoder325/HackTheHill3/issues) [![Watchers](https://img.shields.io/github/watchers/QuantumCoder325/HackTheHill3?style=flat-square)](https://github.com/QuantumCoder325/HackTheHill3/watchers) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)

![C++](https://img.shields.io/badge/-C%2B%2B-555?style=flat-square&logo=c%2B%2B) ![CMake](https://img.shields.io/badge/-CMake-555?style=flat-square&logo=cmake) ![Node.js](https://img.shields.io/badge/-Node.js-555?style=flat-square&logo=node.js) ![Electron](https://img.shields.io/badge/-Electron-555?style=flat-square&logo=electron) ![SmartSpectra SDK](https://img.shields.io/badge/-SmartSpectra%20SDK-555?style=flat-square&logo=smartspectra%20sdk)

[🐛 Report Bug](https://github.com/QuantumCoder325/vitaspectra/issues) · [✨ Request Feature](https://github.com/QuantumCoder325/vitaspectra/issues)

</div>

---

## 📋 Table of Contents

- [📸 Screenshots](#screenshots)
- [⚙️ Prerequisites](#prerequisites)
- [🚀 Installation](#installation)
- [💻 Usage](#usage)
- [✨ Features](#features)
- [📄 License](#license)
- [👤 Contact](#contact)
- [🙏 Acknowledgements](#acknowledgements)

## 📸 Screenshots
![Bird's eye view](./screenshots/birdsEye.png)
![Isometric view](./screenshots/isometric.png)
![No lid, view 1](./screenshots/noLid1.png)
![No lid, view 2](./screenshots/noLid2.png)

## ⚙️ Hardware Used

- Raspberry Pi 5, 8GB
- Raspberry Pi Camera Module 3, standard 75° FOV
- Display (Rayneo Air 4 Pro's were used for the Demo)

## 💻 Usage

```bash
rpicam-vid -t 0 --inline --framerate 30 --width 640 --height 480 --codec yuv420 -o - | \
ffmpeg -fflags nobuffer -flags low_delay -f rawvideo -pix_fmt yuv420p -s 640x480 -r 30 -i - -f v4l2 /dev/video10

Seprately:
npm install
npm start
```

## ✨ Features

- ✅ Breathing rate monitoring
- ✅ Breathing waveform monitoring
- ✅ Pulse rate trace

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

## 👤 Contact

**Trevor,  Aashir, Muhammad, Rayyan**
- GitHub: [@QuantumCoder325](https://github.com/QuantumCoder325)
- Project: [https://github.com/QuantumCoder325/vitaspectra](https://github.com/QuantumCoder325/vitaspectra)

## 🙏 Acknowledgements

- Hack The Hill 3 (For Hosting)
- MLH (For Hardware Support)

---

<div align="center">Made with ❤️ by Trevor,  Aashir, Muhammad, Rayyan</div>
