<script lang="ts">
    import "../app.css";
    import type { Snippet } from "svelte";
    import { onMount } from "svelte";
    import { initTheme } from "#lib/theme-store.js";
    import ConfirmDialog from "#components/ConfirmDialog.svelte";
    import Toast from "#components/Toast.svelte";
    import SettingsModal from "#components/SettingsModal.svelte";
    import UpdateBanner from "#components/UpdateBanner.svelte";
    import { registerServiceWorker } from "#lib/updates.svelte.js";

    let { children }: { children: Snippet } = $props();

    console.log(
        "%cSquiffy %c" + __APP_VERSION__ + "\n%chttps://squiffystory.com",
        "font-weight:700;font-size:14px;color:#0ea5e9",
        "font-weight:400;color:#64748b",
        "color:#64748b",
    );

    onMount(() => {
        initTheme();
        void registerServiceWorker();
    });
</script>

{@render children()}
<UpdateBanner />
<ConfirmDialog />
<Toast />
<SettingsModal />
