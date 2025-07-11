# Audio Assets

## Required Audio Files

### Clock Ticking Sound
- **File**: `clock-tick.mp3` (or `.wav`, `.ogg`)
- **Duration**: 1-2 seconds (should loop seamlessly)
- **Volume**: Moderate level, will be controlled by user setting
- **Usage**: Plays continuously during focus sessions when enabled

### Background Noise Files (in backgrounds/ subdirectory)
- **backgrounds/rain.mp3**: Rain sound (gentle rainfall)
- **backgrounds/fire.mp3**: Fireplace crackling sound
- **backgrounds/library.mp3**: Library ambient sound
- **backgrounds/wind.mp3**: Wind sound
- **backgrounds/storm.mp3**: Storm/thunder sound
- **backgrounds/whitenoise.wav**: Pure white noise

### Sound Requirements
- Format: MP3, WAV, or OGG for web compatibility
- Quality: 44.1kHz, 16-bit minimum
- File size: Keep under 500KB for quick loading (background noises can be larger)
- Duration: 30-60 seconds minimum, should loop seamlessly
- Licensing: Ensure royalty-free or properly licensed

## Implementation Notes
The audio files will be loaded and managed by the AudioManager utility class.
- Ticking sound will only play during focus sessions, not during breaks or long breaks.
- Background noise will play during focus sessions when enabled and selected.
- All audio files should have seamless loops for continuous playback.
- Volume controls are separate for ticking and background noise.