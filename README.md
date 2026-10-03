privi/
├── boot/
│   └── privi_boot.c
├── kernel/
│   ├── kernel.c
│   └── ledger.c
├── include/
│   └── privi.h
└── Makefile 

/* privi_boot.c
 *
 * Privi Boot Loader - prototype
 */

#include <stdint.h>
#include <stddef.h>

#define PRIVI_MAGIC 0x5052495649424F4FULL  /* "PRIVIBOO" */

typedef struct {
    uint64_t magic;
    uint64_t boot_time;
    uint64_t memory_size;

    void *memory_map;
    void *framebuffer;

    char kernel_hash[65];

} PriviBootInfo;

typedef void (*PriviKernelEntry)(PriviBootInfo *);

static void halt(void)
{
    for (;;) {
#if defined(__x86_64__)
        __asm__ volatile ("hlt");
#endif
    }
}

static int verify_kernel(const unsigned char *kernel,
                         size_t kernel_size)
{
    if (!kernel || kernel_size == 0)
        return 0;

    /*
     * Prototype only.
     *
     * Production Privi should verify a cryptographic
     * signature/hash before executing the kernel.
     */

    return 1;
}

void privi_boot(void *kernel_image,
                size_t kernel_size,
                uintptr_t kernel_entry_address)
{
    PriviBootInfo info = {0};

    info.magic = PRIVI_MAGIC;

    if (!verify_kernel(
            (const unsigned char *)kernel_image,
            kernel_size)) {

        halt();
    }

    PriviKernelEntry kernel =
        (PriviKernelEntry)kernel_entry_address;

    kernel(&info);

#include <stdint.h>

#define PRIVI_MAGIC 0x5052495649424F4FULL

typedef struct {
    uint64_t magic;
    uint64_t boot_time;
    uint64_t memory_size;
    void *memory_map;
    void *framebuffer;
    char kernel_hash[65];
} PriviBootInfo;

void privi_ledger_start(void);
void privi_ledger_write(const char *event);

void privi_kernel_main(PriviBootInfo *boot)
{
    if (!boot || boot->magic != PRIVI_MAGIC) {
        for (;;) {}
    }

    privi_ledger_start();

    privi_ledger_write("PRIVI_BOOT_ACCEPTED");
    privi_ledger_write("PRIVI_KERNEL_STARTED");

    /*
     * Next:
     * memory manager
     * device manager
     * filesystem
     * networking
     * Privi blockchain
     * Privi language runtime
     * application launcher
     */

    privi_ledger_write("PRIVI_SYSTEM_READY");

    for (;;) {
#if defined(__x86_64__)
        __asm__ volatile ("hlt");
#endif
    }
}
    /* Kernel should never return. */
    halt();
}
