#define _FILE_OFFSET_BITS 64

#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "generator.h"
#include "util.h"

static int write_exact(FILE *fp, const void *ptr, size_t elem_size, size_t elem_count, const char *label)
{
    if (fwrite(ptr, elem_size, elem_count, fp) != elem_count)
    {
        fprintf(stderr, "Failed to write %s: %s\n", label, strerror(errno));
        return -1;
    }
    return 0;
}

static int make_path(char *dst, size_t dst_size, const char *dir, const char *name)
{
    int n = snprintf(dst, dst_size, "%s/%s", dir, name);
    return n > 0 && (size_t)n < dst_size ? 0 : -1;
}

int main(int argc, char **argv)
{
    if (argc != 5)
    {
        fprintf(stderr, "Usage: %s <seed> <min-coordinate> <max-coordinate> <output-directory>\n", argv[0]);
        return 2;
    }

    char *end = NULL;
    errno = 0;
    uint64_t seed = strtoull(argv[1], &end, 10);
    if (errno != 0 || end == argv[1] || *end != '\0')
    {
        fprintf(stderr, "Invalid seed: %s\n", argv[1]);
        return 2;
    }

    const int min_coord = (int)strtol(argv[2], NULL, 10);
    const int max_coord = (int)strtol(argv[3], NULL, 10);
    const int scale = 4;
    if (max_coord <= min_coord || min_coord % scale != 0 || max_coord % scale != 0)
    {
        fprintf(stderr, "Coordinate bounds must be ordered and divisible by %d.\n", scale);
        return 2;
    }

    const int width = (max_coord - min_coord) / scale;
    const int height = width;
    const int stripe_rows = 64;
    const int sample_x = min_coord / scale;
    const int sample_z = min_coord / scale;
    const char *output_dir = argv[4];

    char rgb_path[4096];
    char height_path[4096];
    if (make_path(rgb_path, sizeof(rgb_path), output_dir, "terrain.rgb") != 0 ||
        make_path(height_path, sizeof(height_path), output_dir, "height.f32") != 0)
    {
        fprintf(stderr, "Output path is too long.\n");
        return 2;
    }

    FILE *rgb_file = fopen(rgb_path, "wb");
    FILE *height_file = fopen(height_path, "wb");
    if (!rgb_file || !height_file)
    {
        fprintf(stderr, "Unable to open output files in %s: %s\n", output_dir, strerror(errno));
        if (rgb_file) fclose(rgb_file);
        if (height_file) fclose(height_file);
        return 3;
    }

    Generator generator;
    setupGenerator(&generator, MC_1_20, 0);
    applySeed(&generator, DIM_OVERWORLD, seed);

    SurfaceNoise surface_noise;
    initSurfaceNoise(&surface_noise, DIM_OVERWORLD, seed);

    unsigned char biome_colors[256][3];
    initBiomeColors(biome_colors);

    const size_t max_cells = (size_t)width * (size_t)stripe_rows;
    float *surface_heights = (float *)malloc(max_cells * sizeof(float));
    unsigned char *rgb = (unsigned char *)malloc(max_cells * 3u);
    if (!surface_heights || !rgb)
    {
        fprintf(stderr, "Out of memory while allocating stripe buffers.\n");
        fclose(rgb_file);
        fclose(height_file);
        free(surface_heights);
        free(rgb);
        return 4;
    }

    fprintf(stdout, "Rendering Java 1.20 terrain for seed %" PRIu64 " (%dx%d samples, 4 blocks/sample)\n", seed, width, height);

    for (int row = 0; row < height; row += stripe_rows)
    {
        const int rows = row + stripe_rows <= height ? stripe_rows : height - row;
        const size_t cells = (size_t)width * (size_t)rows;
        const int height_rc = mapApproxHeight(surface_heights, NULL, &generator, &surface_noise,
                                              sample_x, sample_z + row, width, rows);
        if (height_rc != 0)
        {
            fprintf(stderr, "mapApproxHeight failed at source Z=%d with code %d.\n", sample_z + row, height_rc);
            fclose(rgb_file);
            fclose(height_file);
            free(surface_heights);
            free(rgb);
            return 5;
        }

        /* Sample the underlying surface-biome layer at block Y=320. Using a
         * high Y avoids painting cave-only biomes into the top-down map. */
        Range biome_range = {4, sample_x, sample_z + row, width, rows, 80, 1};
        int *biome_cache = allocCache(&generator, biome_range);
        if (!biome_cache)
        {
            fprintf(stderr, "Unable to allocate Cubiomes cache at source Z=%d.\n", sample_z + row);
            fclose(rgb_file);
            fclose(height_file);
            free(surface_heights);
            free(rgb);
            return 5;
        }
        const int biome_rc = genBiomes(&generator, biome_cache, biome_range);
        if (biome_rc != 0)
        {
            fprintf(stderr, "genBiomes failed at source Z=%d with code %d.\n", sample_z + row, biome_rc);
            free(biome_cache);
            fclose(rgb_file);
            fclose(height_file);
            free(surface_heights);
            free(rgb);
            return 5;
        }

        for (size_t i = 0; i < cells; ++i)
        {
            const int id = biome_cache[i];
            if (id >= 0 && id < 256)
            {
                rgb[i * 3 + 0] = biome_colors[id][0];
                rgb[i * 3 + 1] = biome_colors[id][1];
                rgb[i * 3 + 2] = biome_colors[id][2];
            }
            else
            {
                rgb[i * 3 + 0] = 88;
                rgb[i * 3 + 1] = 96;
                rgb[i * 3 + 2] = 91;
            }
        }

        free(biome_cache);

        if (write_exact(rgb_file, rgb, 3u, cells, "terrain RGB") != 0 ||
            write_exact(height_file, surface_heights, sizeof(float), cells, "surface height") != 0)
        {
            fclose(rgb_file);
            fclose(height_file);
            free(surface_heights);
            free(rgb);
            return 6;
        }

        fprintf(stdout, "\r%5.1f%%", 100.0 * (double)(row + rows) / (double)height);
        fflush(stdout);
    }

    fprintf(stdout, "\nDone: %s and %s\n", rgb_path, height_path);
    fclose(rgb_file);
    fclose(height_file);
    free(surface_heights);
    free(rgb);
    return 0;
}
