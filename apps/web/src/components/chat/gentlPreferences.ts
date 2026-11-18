import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { GentlTaskFilters } from "./GentlBoardFilters";

export interface GentlPreferences {
  workspaceKey: string | null;
  boardId: string | null;
  filters: GentlTaskFilters;
}

export const EMPTY_GENTL_PREFERENCES: GentlPreferences = {
  workspaceKey: null,
  boardId: null,
  filters: {},
};

export const useGentlPreferences = create<{
  byProject: Record<string, GentlPreferences>;
  save: (projectKey: string, preferences: GentlPreferences) => void;
}>()(
  persist(
    (set) => ({
      byProject: {},
      save: (projectKey, preferences) =>
        set((state) => ({ byProject: { ...state.byProject, [projectKey]: preferences } })),
    }),
    {
      name: "t3:gentl:project-preferences",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);
