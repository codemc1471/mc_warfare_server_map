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
    const int source_scale = 4;
    if (max_coord <= min_coord || min_coord % source_scale != 0 || max_coord % source_scale != 0)
    {
        fprintf(stderr, "Coordinate bounds must be ordered and divisible by %d.\n", source_scale);
        return 2;
    }

    const int width = (max_coord - min_coord) / source_scale;
    const int height = width;
    const int stripe_rows = 64;
    const int sample_x = min_coord / source_scale;
    const int sample_z = min_coord / source_scale;

    char height_path[4096], biome_path[4096];
    if (snprintf(height_path, sizeof(height_path), "%s/height.f32", argv[4]) <= 0 ||
        snprintf(biome_path, sizeof(biome_path), "%s/biome.rgb", argv[4]) <= 0)
    {
        fprintf(stderr, "Output path is invalid.\n");
        return 2;
    }

    FILE *height_file = fopen(height_path, "wb");
    FILE *biome_file = fopen(biome_path, "wb");
    if (!height_file || !biome_file)
    {
        fprintf(stderr, "Unable to open output files: %s\n", strerror(errno));
        if (height_file) fclose(height_file);
        if (biome_file) fclose(biome_file);
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
    int *biome_ids = (int *)malloc(max_cells * sizeof(int));
    unsigned char *rgb = (unsigned char *)malloc(max_cells * 3);
    if (!surface_heights || !biome_ids || !rgb)
    {
        fprintf(stderr, "Out of memory.\n");
        fclose(height_file);
        fclose(biome_file);
        free(surface_heights); free(biome_ids); free(rgb);
        return 4;
    }

    fprintf(stdout,
            "Sampling Java 1.20 biome colors and approximate terrain for seed %" PRIu64
            " (%dx%d samples, 4 blocks/sample)\n",
            seed, width, height);

    for (int row = 0; row < height; row += stripe_rows)
    {
        const int rows = row + stripe_rows <= height ? stripe_rows : height - row;
        const size_t cells = (size_t)width * (size_t)rows;
        const int rc = mapApproxHeight(surface_heights, biome_ids, &generator, &surface_noise,
                                       sample_x, sample_z + row, width, rows);
        if (rc != 0)
        {
            fprintf(stderr, "mapApproxHeight failed at Z=%d with code %d.\n", sample_z + row, rc);
            fclose(height_file); fclose(biome_file);
            free(surface_heights); free(biome_ids); free(rgb);
            return 5;
        }

        for (size_t i = 0; i < cells; ++i)
        {
            int id = biome_ids[i];
            if (id < 0 || id > 255) id = 0;
            rgb[i * 3 + 0] = biome_colors[id][0];
            rgb[i * 3 + 1] = biome_colors[id][1];
            rgb[i * 3 + 2] = biome_colors[id][2];
        }

        if (write_exact(height_file, surface_heights, sizeof(float), cells, "surface height") != 0 ||
            write_exact(biome_file, rgb, 1, cells * 3, "biome RGB") != 0)
        {
            fclose(height_file); fclose(biome_file);
            free(surface_heights); free(biome_ids); free(rgb);
            return 6;
        }

        fprintf(stdout, "\r%5.1f%%", 100.0 * (double)(row + rows) / (double)height);
        fflush(stdout);
    }

    fprintf(stdout, "\nDone: %s and %s\n", height_path, biome_path);
    fclose(height_file);
    fclose(biome_file);
    free(surface_heights); free(biome_ids); free(rgb);
    return 0;
}
