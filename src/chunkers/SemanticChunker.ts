import { getEncoding, Tiktoken } from 'js-tiktoken';
import { v4 as uuidv4 } from 'uuid';

export interface Chunk {
  id: string;
  text: string;
  tokenCount: number;
  metadata: Record<string, any>;
}

export class SemanticChunker {
  private encoding: Tiktoken;
  private minTokens: number;
  private maxTokens: number;
  private overlapTokens: number;

  constructor(minTokens = 300, maxTokens = 1200, overlapTokens = 150) {
    this.encoding = getEncoding('cl100k_base');
    this.minTokens = minTokens;
    this.maxTokens = maxTokens;
    this.overlapTokens = overlapTokens;
  }

  public chunkText(markdown: string, baseMetadata: Record<string, any> = {}): Chunk[] {
    if (!markdown) return [];

    const blocks = this.parseMarkdownBlocks(markdown);
    const chunks: Chunk[] = [];
    
    let currentChunkBlocks: string[] = [];
    let currentChunkTokens = 0;
    
    let currentH1 = '';
    let currentH2 = '';
    let currentH3 = '';
    let chunkIndex = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const blockTokens = this.encoding.encode(block).length;

      const isH1 = block.match(/^#\s+(.*)/);
      const isH2 = block.match(/^##\s+(.*)/);
      const isH3 = block.match(/^###\s+(.*)/);

      // Semantic Split: If we have reached minTokens and hit a major heading, split cleanly.
      if ((isH1 || isH2 || isH3) && currentChunkTokens >= this.minTokens) {
        chunks.push(this.flushChunk(currentChunkBlocks, currentH1, currentH2, currentH3, baseMetadata, chunkIndex++));
        currentChunkBlocks = [];
        currentChunkTokens = 0;
      }

      // Update current headings AFTER we decided to split, so the new chunk gets the new heading.
      if (isH1) { currentH1 = isH1[1].trim(); currentH2 = ''; currentH3 = ''; }
      if (isH2) { currentH2 = isH2[1].trim(); currentH3 = ''; }
      if (isH3) { currentH3 = isH3[1].trim(); }

      // Hard Split for giant blocks
      if (blockTokens > this.maxTokens) {
        if (currentChunkBlocks.length > 0) {
          chunks.push(this.flushChunk(currentChunkBlocks, currentH1, currentH2, currentH3, baseMetadata, chunkIndex++));
          currentChunkBlocks = [];
          currentChunkTokens = 0;
        }

        const largeBlockChunks = this.splitLargeBlock(block, currentH1, currentH2, currentH3, baseMetadata, chunkIndex);
        chunks.push(...largeBlockChunks.chunks);
        chunkIndex = largeBlockChunks.nextIndex;
        continue;
      }

      // Max Token Split
      if (currentChunkTokens + blockTokens > this.maxTokens) {
        chunks.push(this.flushChunk(currentChunkBlocks, currentH1, currentH2, currentH3, baseMetadata, chunkIndex++));
        
        const overlapBlocks = this.getOverlapBlocks(currentChunkBlocks);
        currentChunkBlocks = [...overlapBlocks, block];
        currentChunkTokens = this.calculateTokens(currentChunkBlocks);
      } else {
        currentChunkBlocks.push(block);
        currentChunkTokens += blockTokens;
      }
    }

    // Flush remaining
    if (currentChunkBlocks.length > 0) {
      const lastChunk = this.flushChunk(currentChunkBlocks, currentH1, currentH2, currentH3, baseMetadata, chunkIndex++);
      
      // Prevent tiny useless chunks by merging with the previous chunk if possible
      if (chunks.length > 0 && lastChunk.tokenCount < this.minTokens) {
        const prevChunk = chunks[chunks.length - 1];
        if (prevChunk.tokenCount + lastChunk.tokenCount <= this.maxTokens + this.overlapTokens) {
          prevChunk.text += '\n\n' + lastChunk.text;
          prevChunk.tokenCount = this.encoding.encode(prevChunk.text).length;
        } else {
          chunks.push(lastChunk);
        }
      } else if (lastChunk.tokenCount > 5) {
        // only push if it has some meaningful length (prevent 1-2 token trailing garbage)
        chunks.push(lastChunk);
      }
    }

    return chunks;
  }

  private parseMarkdownBlocks(markdown: string): string[] {
    const lines = markdown.split('\n');
    const blocks: string[] = [];
    let currentBlock: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }

      if (!inCodeBlock && line.trim() === '') {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock.join('\n'));
          currentBlock = [];
        }
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'));
    }

    return blocks;
  }

  private flushChunk(blocks: string[], h1: string, h2: string, h3: string, baseMetadata: any, index: number): Chunk {
    const text = blocks.join('\n\n');
    const tokenCount = this.encoding.encode(text).length;
    return this.createChunkObject(text, tokenCount, h1, h2, h3, baseMetadata, index);
  }

  private createChunkObject(text: string, tokenCount: number, h1: string, h2: string, h3: string, baseMetadata: any, index: number): Chunk {
    // Hierarchical ID representation
    const hierarchy = [h1, h2, h3].filter(Boolean).map(h => h.replace(/[^a-zA-Z0-9]+/g, '-').substring(0, 15)).join('_');
    const idSuffix = hierarchy ? `${hierarchy}-${uuidv4().slice(0, 6)}` : uuidv4().slice(0, 8);
    
    return {
      id: `chunk-${index}-${idSuffix}`,
      text: text.trim(),
      tokenCount,
      metadata: {
        ...baseMetadata,
        h1, h2, h3,
        embeddings_ready: true,
        chunk_index: index
      }
    };
  }

  private calculateTokens(blocks: string[]): number {
    return this.encoding.encode(blocks.join('\n\n')).length;
  }

  private getOverlapBlocks(blocks: string[]): string[] {
    let overlapCount = 0;
    const overlapBlocks: string[] = [];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const tokens = this.encoding.encode(blocks[i]).length;
      if (overlapCount + tokens > this.overlapTokens) break;
      overlapBlocks.unshift(blocks[i]);
      overlapCount += tokens;
    }
    return overlapBlocks;
  }

  private splitLargeBlock(text: string, h1: string, h2: string, h3: string, baseMetadata: any, startIndex: number) {
    const tokens = this.encoding.encode(text);
    const result: Chunk[] = [];
    let index = startIndex;

    for (let i = 0; i < tokens.length; i += (this.maxTokens - this.overlapTokens)) {
      const chunkTokens = tokens.slice(i, i + this.maxTokens);
      const chunkText = this.encoding.decode(chunkTokens);
      result.push(this.createChunkObject(chunkText, chunkTokens.length, h1, h2, h3, baseMetadata, index++));
    }
    return { chunks: result, nextIndex: index };
  }
}
