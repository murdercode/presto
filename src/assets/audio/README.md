# Audio Assets

## Required Audio Files

### Clock Ticking Sound
- **File**: `clock-tick.mp3` (or `.wav`, `.ogg`)
- **Duration**: 1-2 seconds (should loop seamlessly)
- **Volume**: Moderate level, will be controlled by user setting
- **Usage**: Plays continuously during focus sessions when enabled

### Sound Requirements
- Format: MP3, WAV, or OGG for web compatibility
- Quality: 44.1kHz, 16-bit minimum
- File size: Keep under 100KB for quick loading
- Licensing: Ensure royalty-free or properly licensed

## Implementation Notes
The audio files will be loaded and managed by the AudioManager utility class.
Ticking sound will only play during focus sessions, not during breaks or long breaks.