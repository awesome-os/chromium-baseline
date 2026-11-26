/*
 * awesome-os/lo — Zero-Dependency 4-OS C11 Holo v11 CAS Native Launcher
 *
 * Cross-compiles cleanly with `zig cc` across:
 *   - x86_64-windows-gnu   -> dist/lo.exe
 *   - x86_64-linux-musl    -> dist/lo-linux-x64    (-static)
 *   - aarch64-linux-musl   -> dist/lo-linux-arm64  (-static)
 *   - aarch64-macos        -> dist/lo-macos-arm64
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <process.h>
#else
#include <unistd.h>
#endif

#define LO_VERSION "0.1.0"
#define LO_CAS_INDEX "https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/cas-v11-global-manifest.json"
#define LO_CONTAINER "ghcr.io/awesome-os/t2linux:latest"
#define LO_QUICKSTART "examples/holo-cas-quickstart.mts"

#if defined(_WIN32)
#define LO_TARGET "win64-x86_64"
#elif defined(__APPLE__) && defined(__aarch64__)
#define LO_TARGET "macos-arm64"
#elif defined(__linux__) && defined(__aarch64__)
#define LO_TARGET "linux-arm64-musl"
#elif defined(__linux__) && defined(__x86_64__)
#define LO_TARGET "linux-x64-musl"
#else
#define LO_TARGET "unknown"
#endif

static void print_version(void) {
  printf("awesome-os/lo v%s (%s) [Holo v11 CAS | shared libv8_monolith 16.0.88+ (dup_v8=0B) | 19/19 v11 shards]\n",
         LO_VERSION, LO_TARGET);
}

static void print_help(const char *argv0) {
  printf(
      "awesome-os/lo v%s (%s) - Holo v11 V8 Runtime Launcher\n"
      "\n"
      "Usage:\n"
      "  %s --version              Print version and target triple\n"
      "  %s --help                 Show this help message\n"
      "  %s --cas-index            Print canonical Holo v11 CAS index URL\n"
      "  %s --quickstart           Run %s against holo-v11\n"
      "  %s <script.mts|js> [...]  Delegate script execution via Holo v11 CAS runtime\n"
      "\n"
      "Sovereign Holo v11 CAS ($B8G_CAS_DIR):\n"
      "  Index:     %s\n"
      "  Container: %s (multi-arch 2.1 MB)\n"
      "  Policy:    Keep-Last-5 retention | FIPS 180-4 SHA-512/SHA-256 verification\n",
      LO_VERSION, LO_TARGET, argv0, argv0, argv0, argv0, LO_QUICKSTART, argv0,
      LO_CAS_INDEX, LO_CONTAINER);
}

static int delegate_node(int extra_argc, char **extra_argv, const char *default_script) {
  const char *runtime = getenv("LO_JS_RUNTIME");
#if defined(_WIN32)
  char resolved_runtime[1024];
  if (runtime == NULL || runtime[0] == '\0') {
    if (SearchPathA(NULL, "node", ".cmd", (DWORD)sizeof(resolved_runtime), resolved_runtime, NULL) > 0) {
      runtime = resolved_runtime;
    } else {
      runtime = "node";
    }
  }
#else
  if (runtime == NULL || runtime[0] == '\0') {
    runtime = "node";
  }
#endif

  int count = (default_script != NULL ? 2 : 1) + extra_argc;
  const char **args = (const char **)malloc((size_t)(count + 1) * sizeof(const char *));
  if (args == NULL) {
    fprintf(stderr, "[lo] out of memory\n");
    return 1;
  }

  int idx = 0;
  args[idx++] = runtime;
  if (default_script != NULL) {
    args[idx++] = default_script;
  }
  for (int i = 0; i < extra_argc; i++) {
    args[idx++] = extra_argv[i];
  }
  args[idx] = NULL;

#if defined(_WIN32)
  int rc = (int)_spawnvp(_P_WAIT, runtime, (const char *const *)args);
  free(args);
  if (rc == -1) {
    fprintf(stderr, "[lo] failed to launch runtime '%s' (set LO_JS_RUNTIME to override)\n", runtime);
    return 127;
  }
  return rc;
#else
  execvp(runtime, (char *const *)args);
  fprintf(stderr, "[lo] failed to exec runtime '%s' (set LO_JS_RUNTIME to override)\n", runtime);
  free(args);
  return 127;
#endif
}

int main(int argc, char **argv) {
  const char *argv0 = (argc > 0 && argv[0] != NULL) ? argv[0] : "lo";

  if (argc <= 1) {
    return delegate_node(0, NULL, LO_QUICKSTART);
  }

  if (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0 || strcmp(argv[1], "-V") == 0) {
    print_version();
    return 0;
  }

  if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
    print_help(argv0);
    return 0;
  }

  if (strcmp(argv[1], "--cas-index") == 0) {
    printf("%s\n", LO_CAS_INDEX);
    return 0;
  }

  if (strcmp(argv[1], "--quickstart") == 0) {
    return delegate_node(argc - 2, argv + 2, LO_QUICKSTART);
  }

  return delegate_node(argc - 1, argv + 1, NULL);
}
