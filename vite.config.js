import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three-core is a single monolithic minified module; 700 kB is its real
    // size — the split below moves examples/jsm out, the rest can't be smaller
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three-core', test: /node_modules[\\/]three[\\/](src|build)/, priority: 2 },
            { name: 'three-examples', test: /node_modules[\\/]three[\\/]examples/, priority: 2 },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
});
