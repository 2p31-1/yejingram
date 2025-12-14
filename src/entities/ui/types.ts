export interface UIState {
    // 0 - 100 upload progress percent
    syncProgress?: number;
    // Force show full-screen sync modal (e.g., manual restore)
    forceShowSyncModal?: boolean;
}
