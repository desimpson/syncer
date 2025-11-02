import { describe, it, expect } from "vitest";
import { generateSyncActions } from "@/sync/actions";
import type { SyncItem, SyncAction } from "@/sync/types";

describe("generateSyncActions", () => {
  type TestCase = {
    name: string;
    incoming: SyncItem[];
    existing: SyncItem[];
    expected: SyncAction[];
  };

  const cases: TestCase[] = [
    {
      name: "no changes returns empty actions",
      incoming: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      expected: [],
    },
    {
      name: "creates new items",
      incoming: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      existing: [],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "create",
        },
      ],
    },
    {
      name: "deletes removed items",
      incoming: [],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "delete",
        },
      ],
    },
    {
      name: "updates items when title changes",
      incoming: [
        {
          id: "1",
          title: "Task A Updated",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
        },
      ],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A Updated",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when link changes",
      incoming: [
        { id: "1", title: "Task A", link: "linkB", source: "google-tasks", heading: "# Work" },
      ],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkB",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when heading changes",
      incoming: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Personal" },
      ],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Personal",
          },
          operation: "update",
        },
      ],
    },
    {
      name: "mixed create, update, delete",
      incoming: [
        {
          id: "1",
          title: "Task A Updated",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
        }, // update
        { id: "2", title: "Task B", link: "linkB", source: "google-tasks", heading: "# Work" }, // create
      ],
      existing: [
        { id: "1", title: "Task A", link: "linkA", source: "google-tasks", heading: "# Work" },
        { id: "3", title: "Task C", link: "linkC", source: "google-tasks", heading: "# Work" }, // delete
      ],
      expected: [
        {
          item: {
            id: "2",
            title: "Task B",
            link: "linkB",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "create",
        },
        {
          item: {
            id: "1",
            title: "Task A Updated",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "update",
        },
        {
          item: {
            id: "3",
            title: "Task C",
            link: "linkC",
            source: "google-tasks",
            heading: "# Work",
          },
          operation: "delete",
        },
      ],
    },
  ];

  cases.forEach(({ name, incoming, existing, expected }) => {
    it(name, () => {
      const actions = generateSyncActions(incoming, existing);
      expect(actions).toEqual(expected);
    });
  });
});
