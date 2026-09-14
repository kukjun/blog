// macOS arm64 fixture for statfs-width-repro.mjs. No filesystem is mounted.
#include <sys/param.h>
#include <sys/mount.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

static int fixture_statfs(const char *path, struct statfs *buf) {
  if (strcmp(path, "/__statfs_width_fixture__") != 0) return statfs(path, buf);
  const char *scenario = getenv("STATFS_BLOG_CASE");
  uint64_t blocks = UINT64_C(1) << 43;
  uint64_t bfree = blocks - 7;
  uint64_t bavail = blocks - 9;
  if (scenario && strcmp(scenario, "small") == 0) {
    blocks = 1000000; bfree = 750000; bavail = 749000;
  } else if (scenario && strcmp(scenario, "signed-edge") == 0) {
    blocks = (UINT64_C(1) << 31) + 20;
    bfree = bavail = UINT64_C(1) << 31;
  } else if (scenario && strcmp(scenario, "positive-wrap") == 0) {
    blocks = (UINT64_C(1) << 32) + 20;
    bfree = (UINT64_C(1) << 32) + 10;
    bavail = (UINT64_C(1) << 32) + 9;
  }
  memset(buf, 0, sizeof(*buf));
  buf->f_type = 12345; // A sentinel: fail if the fixture was not interposed.
  buf->f_bsize = 4096;
  buf->f_blocks = blocks;
  buf->f_bfree = bfree;
  buf->f_bavail = bavail;
  buf->f_files = 100;
  buf->f_ffree = 90;
  return 0;
}

__attribute__((used)) static struct {
  const void *replacement;
  const void *original;
} hooks[] __attribute__((section("__DATA,__interpose"))) = {
  {(const void *)fixture_statfs, (const void *)statfs}
};
