import * as fs from 'fs';
import { StringDecoder } from 'string_decoder';

const CHUNK = 4 * 1024 * 1024;

/** Reads a growing JSONL file from where it last stopped. */
export class TailReader {
  private offset = 0;
  private rest = '';
  private decoder = new StringDecoder('utf8');
  private busy = false;

  constructor(readonly file: string) {}

  /** Returns 'reset' if the file shrank (rewritten), true if new lines were read. */
  async read(onLine: (line: string) => void): Promise<boolean | 'reset'> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const st = await fs.promises.stat(this.file);
      if (st.size < this.offset) {
        this.offset = 0;
        this.rest = '';
        this.decoder = new StringDecoder('utf8');
        return 'reset';
      }
      if (st.size === this.offset) return false;
      const fh = await fs.promises.open(this.file, 'r');
      try {
        let pos = this.offset;
        const buf = Buffer.alloc(Math.min(CHUNK, st.size - pos));
        while (pos < st.size) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - pos), pos);
          if (bytesRead === 0) break;
          pos += bytesRead;
          const lines = (this.rest + this.decoder.write(buf.subarray(0, bytesRead))).split('\n');
          this.rest = lines.pop() ?? '';
          for (const line of lines) if (line) onLine(line);
        }
        this.offset = pos;
      } finally {
        await fh.close();
      }
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}
