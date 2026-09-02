/**
 * Database schema types.
 *
 * Hand-written to mirror `supabase/migrations/`, in the same shape the Supabase
 * CLI emits, so it can be swapped for generated output later:
 *
 *   npx supabase gen types typescript --linked > src/types/database.ts
 */

import type { CurrencyCode, GroupRole, PaymentMode } from "@/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Lifecycle of a group invitation. `expired` is set lazily when one is read. */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          name: string;
          email: string;
          created_at?: string;
          updated_at?: string;
        };
        /** Only `name` is editable; the rest are pinned by a database trigger. */
        Update: {
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };

      groups: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          currency_code: CurrencyCode;
          /** Null once the creator deletes their account; the group survives. */
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          currency_code: CurrencyCode;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        /** `id`, `created_by` and `created_at` are pinned by a trigger. */
        Update: {
          name?: string;
          description?: string | null;
          currency_code?: CurrencyCode;
        };
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      group_members: {
        Row: {
          id: string;
          group_id: string;
          user_id: string;
          role: GroupRole;
          joined_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          user_id: string;
          role?: GroupRole;
          joined_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        /** Only the role can change; the membership itself is pinned. */
        Update: {
          role?: GroupRole;
        };
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      group_invitations: {
        Row: {
          id: string;
          group_id: string;
          email: string;
          role: GroupRole;
          /** SHA-256 hex of the emailed token. The token itself is never stored. */
          token_hash: string;
          invited_by: string | null;
          status: InvitationStatus;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id: string;
          email: string;
          role?: GroupRole;
          token_hash: string;
          invited_by: string;
          status?: "pending";
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        /** Revoking or expiring. Acceptance is written by a database trigger. */
        Update: {
          role?: GroupRole;
          status?: Exclude<InvitationStatus, "accepted">;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "group_invitations_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      categories: {
        Row: {
          id: string;
          /** Exactly one of `group_id` / `user_id` is set. */
          group_id: string | null;
          user_id: string | null;
          name: string;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id?: string | null;
          user_id?: string | null;
          name: string;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          is_archived?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "categories_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };

      budgets: {
        Row: {
          id: string;
          group_id: string | null;
          user_id: string | null;
          category_id: string;
          /**
           * numeric(14,2). PostgREST serialises it as a JSON number, so it
           * arrives as a JavaScript number. Sum and compare amounts in SQL,
           * where the type is still exact, rather than in JavaScript.
           */
          amount: number;
          /** `YYYY-MM-01`, or null for the standing monthly budget. */
          period_month: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          group_id?: string | null;
          user_id?: string | null;
          category_id: string;
          amount: number;
          period_month?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          period_month?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "budgets_group_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budgets_user_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budgets_category_in_group_fkey";
            columns: ["category_id", "group_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "group_id"];
          },
          {
            foreignKeyName: "budgets_category_of_user_fkey";
            columns: ["category_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };

      expenses: {
        Row: {
          id: string;
          /** Who recorded it, and the owner when `group_id` is null. */
          user_id: string;
          group_id: string | null;
          paid_by: string;
          category_id: string | null;
          /**
           * Generated: `user_id` when this is a personal expense, otherwise
           * null. Exists so the personal-category foreign key skips group
           * expenses. Read-only — the database computes it.
           */
          personal_owner_id: string | null;
          item_name: string;
          /**
           * numeric(14,2). PostgREST serialises it as a JSON number, so it
           * arrives as a JavaScript number. Sum and compare amounts in SQL,
           * where the type is still exact, rather than in JavaScript.
           */
          amount: number;
          currency_code: CurrencyCode;
          /** `YYYY-MM-DD`. A calendar date, deliberately not a timestamp. */
          expense_date: string;
          payment_mode: PaymentMode | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          group_id?: string | null;
          paid_by: string;
          category_id?: string | null;
          item_name: string;
          amount: number;
          currency_code?: CurrencyCode;
          expense_date: string;
          payment_mode?: PaymentMode | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        /** `user_id`, `group_id` and `created_at` are pinned by a trigger. */
        Update: {
          paid_by?: string;
          category_id?: string | null;
          item_name?: string;
          amount?: number;
          currency_code?: CurrencyCode;
          expense_date?: string;
          payment_mode?: PaymentMode | null;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_group_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_category_in_group_fkey";
            columns: ["category_id", "group_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "group_id"];
          },
          {
            foreignKeyName: "expenses_category_of_user_fkey";
            columns: ["category_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_group_member: {
        Args: { p_group_id: string };
        Returns: boolean;
      };
      is_group_admin: {
        Args: { p_group_id: string };
        Returns: boolean;
      };
      shares_group_with: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      current_user_email: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Profile = Tables<"profiles">;
export type Group = Tables<"groups">;
export type GroupMember = Tables<"group_members">;
export type GroupInvitation = Tables<"group_invitations">;
export type Category = Tables<"categories">;
export type Budget = Tables<"budgets">;
export type Expense = Tables<"expenses">;
