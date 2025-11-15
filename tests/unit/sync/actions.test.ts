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
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [],
    },
    {
      name: "creates new items",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
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
            completed: false,
          },
          operation: "create",
        },
      ],
    },
    {
      name: "deletes removed items",
      incoming: [],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
            completed: false,
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
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A Updated",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
            completed: false,
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when link changes",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkB",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkB",
            source: "google-tasks",
            heading: "# Work",
            completed: false,
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when heading changes",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Personal",
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Personal",
            completed: false,
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when completion status changes from false to true",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: true,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
            completed: true,
          },
          operation: "update",
        },
      ],
    },
    {
      name: "updates items when completion status changes from true to false",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: true,
        },
      ],
      expected: [
        {
          item: {
            id: "1",
            title: "Task A",
            link: "linkA",
            source: "google-tasks",
            heading: "# Work",
            completed: false,
          },
          operation: "update",
        },
      ],
    },
    {
      name: "does not update when completion status is unchanged",
      incoming: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
      ],
      expected: [],
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
          completed: false,
        }, // update
        {
          id: "2",
          title: "Task B",
          link: "linkB",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        }, // create
      ],
      existing: [
        {
          id: "1",
          title: "Task A",
          link: "linkA",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        },
        {
          id: "3",
          title: "Task C",
          link: "linkC",
          source: "google-tasks",
          heading: "# Work",
          completed: false,
        }, // delete
      ],
      expected: [
        {
          item: {
            id: "2",
            title: "Task B",
            link: "linkB",
            source: "google-tasks",
            heading: "# Work",
            completed: false,
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
            completed: false,
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
            completed: false,
          },
          operation: "delete",
        },
      ],
    },
  ];

  cases.forEach(({ name, incoming, existing, expected }) => {
    it(name, () => {
      // Arrange
      // (incoming and existing are already arranged from test cases)

      // Act
      const actions = generateSyncActions(incoming, existing);

      // Assert
      expect(actions).toEqual(expected);
    });
  });
});
