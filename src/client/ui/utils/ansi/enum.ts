/**
 * @module enum
 */

export const enum PacketType {
  EOS, // End of Operating System Command
  ESC, // A single ESC char - random
  OSC, // Operating System Command
  SGR, // Select Graphic Rendition
  TEXT, // ANSI normal text
  INCESC, // An Incomplete ESC sequence
  UNKNOWN // A valid CSI but not an SGR code
}