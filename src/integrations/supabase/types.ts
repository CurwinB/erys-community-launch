export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_wallets: {
        Row: {
          added_at: string
          email: string | null
          wallet_address: string
        }
        Insert: {
          added_at?: string
          email?: string | null
          wallet_address: string
        }
        Update: {
          added_at?: string
          email?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      contributions: {
        Row: {
          amount_lamports: number
          basis_points: number | null
          contributed_at: string
          distribution_error: string | null
          distribution_tx_signature: string | null
          id: string
          is_fee_claimer: boolean | null
          launch_id: string
          refund_tx_signature: string | null
          token_amount: number | null
          tokens_distributed: boolean | null
          tx_signature: string
          wallet_address: string
        }
        Insert: {
          amount_lamports: number
          basis_points?: number | null
          contributed_at?: string
          distribution_error?: string | null
          distribution_tx_signature?: string | null
          id?: string
          is_fee_claimer?: boolean | null
          launch_id: string
          refund_tx_signature?: string | null
          token_amount?: number | null
          tokens_distributed?: boolean | null
          tx_signature: string
          wallet_address: string
        }
        Update: {
          amount_lamports?: number
          basis_points?: number | null
          contributed_at?: string
          distribution_error?: string | null
          distribution_tx_signature?: string | null
          id?: string
          is_fee_claimer?: boolean | null
          launch_id?: string
          refund_tx_signature?: string | null
          token_amount?: number | null
          tokens_distributed?: boolean | null
          tx_signature?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
        ]
      }
      launches: {
        Row: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_share_config_key: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          launch_datetime: string
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          pumpfun_creator_fees_distributed: number | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_launch_signature: string | null
          pumpfun_mint_keypair_encrypted: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }
        Insert: {
          claimer_count?: number | null
          created_at?: string
          created_by_wallet: string
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors?: number | null
          execution_attempts?: number
          execution_error?: string | null
          fee_share_config_key?: string | null
          id?: string
          image_url?: string | null
          ipfs_metadata_url?: string | null
          launch_datetime: string
          max_contribution_lamports?: number | null
          min_contribution_lamports: number
          platform?: string
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          status?: Database["public"]["Enums"]["launch_status"]
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed?: number | null
          twitter_url?: string | null
          website_url?: string | null
          worker_id?: string | null
          worker_locked_at?: string | null
        }
        Update: {
          claimer_count?: number | null
          created_at?: string
          created_by_wallet?: string
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_encrypted_private_key?: string
          escrow_wallet_public_key?: string
          excluded_contributors?: number | null
          execution_attempts?: number
          execution_error?: string | null
          fee_share_config_key?: string | null
          id?: string
          image_url?: string | null
          ipfs_metadata_url?: string | null
          launch_datetime?: string
          max_contribution_lamports?: number | null
          min_contribution_lamports?: number
          platform?: string
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          status?: Database["public"]["Enums"]["launch_status"]
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string
          token_symbol?: string
          total_tokens_distributed?: number | null
          twitter_url?: string | null
          website_url?: string | null
          worker_id?: string | null
          worker_locked_at?: string | null
        }
        Relationships: []
      }
      platform_fee_claims: {
        Row: {
          amount_lamports: number
          claimed_at: string
          id: string
          tx_signature: string
        }
        Insert: {
          amount_lamports: number
          claimed_at?: string
          id?: string
          tx_signature: string
        }
        Update: {
          amount_lamports?: number
          claimed_at?: string
          id?: string
          tx_signature?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_executing_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_share_config_key: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          launch_datetime: string
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          pumpfun_creator_fees_distributed: number | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_launch_signature: string | null
          pumpfun_mint_keypair_encrypted: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_launch_for_worker: {
        Args: {
          p_lock_expiry_seconds?: number
          p_status: string
          p_worker_id: string
        }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_share_config_key: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          launch_datetime: string
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          pumpfun_creator_fees_distributed: number | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_launch_signature: string | null
          pumpfun_mint_keypair_encrypted: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pumpfun_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_encrypted_private_key: string
          escrow_wallet_public_key: string
          excluded_contributors: number | null
          execution_attempts: number
          execution_error: string | null
          fee_share_config_key: string | null
          id: string
          image_url: string | null
          ipfs_metadata_url: string | null
          launch_datetime: string
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          pumpfun_creator_fees_distributed: number | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_launch_signature: string | null
          pumpfun_mint_keypair_encrypted: string | null
          status: Database["public"]["Enums"]["launch_status"]
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string
          token_symbol: string
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
          worker_id: string | null
          worker_locked_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "launches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      increment_pumpfun_fees_claimed: {
        Args: { amount: number; launch_id: string }
        Returns: undefined
      }
    }
    Enums: {
      launch_status:
        | "scheduled"
        | "executing"
        | "launched"
        | "execution_failed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      launch_status: [
        "scheduled",
        "executing",
        "launched",
        "execution_failed",
        "cancelled",
      ],
    },
  },
} as const
