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
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
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
          refund_shortfall_lamports: number | null
          refund_tx_signature: string | null
          token_amount: number | null
          token_delivery_wallet: string | null
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
          refund_shortfall_lamports?: number | null
          refund_tx_signature?: string | null
          token_amount?: number | null
          token_delivery_wallet?: string | null
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
          refund_shortfall_lamports?: number | null
          refund_tx_signature?: string | null
          token_amount?: number | null
          token_delivery_wallet?: string | null
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
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      custodial_wallet_locks: {
        Row: {
          lock_key: string
          locked_at: string
          locked_by: string
        }
        Insert: {
          lock_key: string
          locked_at?: string
          locked_by: string
        }
        Update: {
          lock_key?: string
          locked_at?: string
          locked_by?: string
        }
        Relationships: []
      }
      launches: {
        Row: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
          creator_delivery_wallet?: string | null
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
          is_sponsored?: boolean | null
          launch_datetime?: string | null
          max_contribution_lamports?: number | null
          min_contribution_lamports: number
          platform?: string
          processing_fee_lamports?: number
          processing_fee_tx_signature?: string | null
          pumpfun_consecutive_empty_claims?: number
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_creator_vault_balance_lamports?: number | null
          pumpfun_creator_vault_checked_at?: string | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_last_claim_attempt_at?: string | null
          pumpfun_last_claim_error?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_low_volume_throttle_until?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          pumpportal_wallet_pubkey?: string | null
          sponsor_funding_attempts?: number
          sponsor_funding_error?: string | null
          sponsor_link_claimed_at?: string | null
          sponsor_link_expires_at?: string | null
          sponsor_link_token?: string | null
          sponsor_recovery_amount_lamports?: number | null
          sponsor_recovery_attempts?: number
          sponsor_recovery_completed_at?: string | null
          sponsor_recovery_error?: string | null
          sponsor_recovery_tx_signature?: string | null
          sponsored_amount_lamports?: number | null
          sponsored_by?: string | null
          sponsored_tx_signature?: string | null
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
          creator_delivery_wallet?: string | null
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
          is_sponsored?: boolean | null
          launch_datetime?: string | null
          max_contribution_lamports?: number | null
          min_contribution_lamports?: number
          platform?: string
          processing_fee_lamports?: number
          processing_fee_tx_signature?: string | null
          pumpfun_consecutive_empty_claims?: number
          pumpfun_creator_fees_distributed?: number | null
          pumpfun_creator_vault_balance_lamports?: number | null
          pumpfun_creator_vault_checked_at?: string | null
          pumpfun_fees_claimed_total?: number | null
          pumpfun_fees_last_claimed_at?: string | null
          pumpfun_last_claim_attempt_at?: string | null
          pumpfun_last_claim_error?: string | null
          pumpfun_launch_signature?: string | null
          pumpfun_low_volume_throttle_until?: string | null
          pumpfun_mint_keypair_encrypted?: string | null
          pumpportal_wallet_pubkey?: string | null
          sponsor_funding_attempts?: number
          sponsor_funding_error?: string | null
          sponsor_link_claimed_at?: string | null
          sponsor_link_expires_at?: string | null
          sponsor_link_token?: string | null
          sponsor_recovery_amount_lamports?: number | null
          sponsor_recovery_attempts?: number
          sponsor_recovery_completed_at?: string | null
          sponsor_recovery_error?: string | null
          sponsor_recovery_tx_signature?: string | null
          sponsored_amount_lamports?: number | null
          sponsored_by?: string | null
          sponsored_tx_signature?: string | null
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
      pumpfun_fee_sweeps: {
        Row: {
          amount_lamports: number
          created_at: string
          id: string
          launch_id: string | null
          notes: string | null
          source_wallet: string
          treasury_wallet: string
          tx_signature: string
        }
        Insert: {
          amount_lamports: number
          created_at?: string
          id?: string
          launch_id?: string | null
          notes?: string | null
          source_wallet: string
          treasury_wallet: string
          tx_signature: string
        }
        Update: {
          amount_lamports?: number
          created_at?: string
          id?: string
          launch_id?: string | null
          notes?: string | null
          source_wallet?: string
          treasury_wallet?: string
          tx_signature?: string
        }
        Relationships: []
      }
    }
    Views: {
      contributions_public: {
        Row: {
          amount_lamports: number | null
          contributed_at: string | null
          id: string | null
          launch_id: string | null
          wallet_address: string | null
        }
        Insert: {
          amount_lamports?: number | null
          contributed_at?: string | null
          id?: string | null
          launch_id?: string | null
          wallet_address?: string | null
        }
        Update: {
          amount_lamports?: number | null
          contributed_at?: string | null
          id?: string | null
          launch_id?: string | null
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contributions_launch_id_fkey"
            columns: ["launch_id"]
            isOneToOne: false
            referencedRelation: "launches_public"
            referencedColumns: ["id"]
          },
        ]
      }
      launches_public: {
        Row: {
          claimer_count: number | null
          created_at: string | null
          created_by_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_public_key: string | null
          fee_share_config_key: string | null
          id: string | null
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number | null
          platform: string | null
          pumpfun_launch_signature: string | null
          sponsored_amount_lamports: number | null
          status: Database["public"]["Enums"]["launch_status"] | null
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string | null
          token_symbol: string | null
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
        }
        Insert: {
          claimer_count?: number | null
          created_at?: string | null
          created_by_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_public_key?: string | null
          fee_share_config_key?: string | null
          id?: string | null
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_datetime?: string | null
          max_contribution_lamports?: number | null
          min_contribution_lamports?: number | null
          platform?: string | null
          pumpfun_launch_signature?: string | null
          sponsored_amount_lamports?: number | null
          status?: Database["public"]["Enums"]["launch_status"] | null
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string | null
          token_symbol?: string | null
          total_tokens_distributed?: number | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Update: {
          claimer_count?: number | null
          created_at?: string | null
          created_by_wallet?: string | null
          description?: string | null
          distribution_completed?: boolean | null
          distribution_completed_at?: string | null
          escrow_wallet_public_key?: string | null
          fee_share_config_key?: string | null
          id?: string | null
          image_url?: string | null
          ipfs_metadata_url?: string | null
          is_sponsored?: boolean | null
          launch_datetime?: string | null
          max_contribution_lamports?: number | null
          min_contribution_lamports?: number | null
          platform?: string | null
          pumpfun_launch_signature?: string | null
          sponsored_amount_lamports?: number | null
          status?: Database["public"]["Enums"]["launch_status"] | null
          telegram_url?: string | null
          token_mint_address?: string | null
          token_name?: string | null
          token_symbol?: string | null
          total_tokens_distributed?: number | null
          twitter_url?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_list_contributions: {
        Args: { p_admin_wallet: string }
        Returns: {
          amount_lamports: number
          basis_points: number | null
          contributed_at: string
          distribution_error: string | null
          distribution_tx_signature: string | null
          id: string
          is_fee_claimer: boolean | null
          launch_id: string
          refund_shortfall_lamports: number | null
          refund_tx_signature: string | null
          token_amount: number | null
          token_delivery_wallet: string | null
          tokens_distributed: boolean | null
          tx_signature: string
          wallet_address: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contributions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_launches: {
        Args: { p_admin_wallet: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      admin_list_pumpfun_fee_health: {
        Args: { p_admin_wallet: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      claim_executing_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      claim_local_signing_pumpfun_launches_batch_for_worker: {
        Args: {
          p_limit?: number
          p_lock_expiry_seconds?: number
          p_worker_id: string
        }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      claim_pumpfun_launches_batch_for_worker:
        | {
            Args: {
              p_limit?: number
              p_lock_expiry_seconds?: number
              p_worker_id: string
            }
            Returns: {
              claimer_count: number | null
              created_at: string
              created_by_wallet: string
              creator_delivery_wallet: string | null
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
              is_sponsored: boolean | null
              launch_datetime: string | null
              max_contribution_lamports: number | null
              min_contribution_lamports: number
              platform: string
              processing_fee_lamports: number
              processing_fee_tx_signature: string | null
              pumpfun_consecutive_empty_claims: number
              pumpfun_creator_fees_distributed: number | null
              pumpfun_creator_vault_balance_lamports: number | null
              pumpfun_creator_vault_checked_at: string | null
              pumpfun_fees_claimed_total: number | null
              pumpfun_fees_last_claimed_at: string | null
              pumpfun_last_claim_attempt_at: string | null
              pumpfun_last_claim_error: string | null
              pumpfun_launch_signature: string | null
              pumpfun_low_volume_throttle_until: string | null
              pumpfun_mint_keypair_encrypted: string | null
              pumpportal_wallet_pubkey: string | null
              sponsor_funding_attempts: number
              sponsor_funding_error: string | null
              sponsor_link_claimed_at: string | null
              sponsor_link_expires_at: string | null
              sponsor_link_token: string | null
              sponsor_recovery_amount_lamports: number | null
              sponsor_recovery_attempts: number
              sponsor_recovery_completed_at: string | null
              sponsor_recovery_error: string | null
              sponsor_recovery_tx_signature: string | null
              sponsored_amount_lamports: number | null
              sponsored_by: string | null
              sponsored_tx_signature: string | null
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
        | {
            Args: {
              p_limit?: number
              p_lock_expiry_seconds?: number
              p_wallet_pubkey?: string
              p_worker_id: string
            }
            Returns: {
              claimer_count: number | null
              created_at: string
              created_by_wallet: string
              creator_delivery_wallet: string | null
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
              is_sponsored: boolean | null
              launch_datetime: string | null
              max_contribution_lamports: number | null
              min_contribution_lamports: number
              platform: string
              processing_fee_lamports: number
              processing_fee_tx_signature: string | null
              pumpfun_consecutive_empty_claims: number
              pumpfun_creator_fees_distributed: number | null
              pumpfun_creator_vault_balance_lamports: number | null
              pumpfun_creator_vault_checked_at: string | null
              pumpfun_fees_claimed_total: number | null
              pumpfun_fees_last_claimed_at: string | null
              pumpfun_last_claim_attempt_at: string | null
              pumpfun_last_claim_error: string | null
              pumpfun_launch_signature: string | null
              pumpfun_low_volume_throttle_until: string | null
              pumpfun_mint_keypair_encrypted: string | null
              pumpportal_wallet_pubkey: string | null
              sponsor_funding_attempts: number
              sponsor_funding_error: string | null
              sponsor_link_claimed_at: string | null
              sponsor_link_expires_at: string | null
              sponsor_link_token: string | null
              sponsor_recovery_amount_lamports: number | null
              sponsor_recovery_attempts: number
              sponsor_recovery_completed_at: string | null
              sponsor_recovery_error: string | null
              sponsor_recovery_tx_signature: string | null
              sponsored_amount_lamports: number | null
              sponsored_by: string | null
              sponsored_tx_signature: string | null
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
      claim_sponsor_funding_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      claim_sponsor_recovery_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      claim_sweep_recovery_launch_for_worker: {
        Args: { p_lock_expiry_seconds?: number; p_worker_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string
          created_by_wallet: string
          creator_delivery_wallet: string | null
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
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number
          platform: string
          processing_fee_lamports: number
          processing_fee_tx_signature: string | null
          pumpfun_consecutive_empty_claims: number
          pumpfun_creator_fees_distributed: number | null
          pumpfun_creator_vault_balance_lamports: number | null
          pumpfun_creator_vault_checked_at: string | null
          pumpfun_fees_claimed_total: number | null
          pumpfun_fees_last_claimed_at: string | null
          pumpfun_last_claim_attempt_at: string | null
          pumpfun_last_claim_error: string | null
          pumpfun_launch_signature: string | null
          pumpfun_low_volume_throttle_until: string | null
          pumpfun_mint_keypair_encrypted: string | null
          pumpportal_wallet_pubkey: string | null
          sponsor_funding_attempts: number
          sponsor_funding_error: string | null
          sponsor_link_claimed_at: string | null
          sponsor_link_expires_at: string | null
          sponsor_link_token: string | null
          sponsor_recovery_amount_lamports: number | null
          sponsor_recovery_attempts: number
          sponsor_recovery_completed_at: string | null
          sponsor_recovery_error: string | null
          sponsor_recovery_tx_signature: string | null
          sponsored_amount_lamports: number | null
          sponsored_by: string | null
          sponsored_tx_signature: string | null
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
      force_pumpfun_fee_claim_retry: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      get_launch_platform_status: {
        Args: never
        Returns: {
          bags_enabled: boolean
          bags_updated_at: string
          pumpfun_enabled: boolean
          pumpfun_updated_at: string
        }[]
      }
      get_launch_public: {
        Args: { p_id: string }
        Returns: {
          claimer_count: number | null
          created_at: string | null
          created_by_wallet: string | null
          description: string | null
          distribution_completed: boolean | null
          distribution_completed_at: string | null
          escrow_wallet_public_key: string | null
          fee_share_config_key: string | null
          id: string | null
          image_url: string | null
          ipfs_metadata_url: string | null
          is_sponsored: boolean | null
          launch_datetime: string | null
          max_contribution_lamports: number | null
          min_contribution_lamports: number | null
          platform: string | null
          pumpfun_launch_signature: string | null
          sponsored_amount_lamports: number | null
          status: Database["public"]["Enums"]["launch_status"] | null
          telegram_url: string | null
          token_mint_address: string | null
          token_name: string | null
          token_symbol: string | null
          total_tokens_distributed: number | null
          twitter_url: string | null
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "launches_public"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_sponsor_slot_by_token: {
        Args: { p_token: string }
        Returns: {
          id: string
          launch_datetime: string
          sponsor_link_expires_at: string
          sponsored_amount_lamports: number
          status: string
          token_name: string
          token_symbol: string
        }[]
      }
      increment_pumpfun_fees_claimed: {
        Args: { amount: number; launch_id: string }
        Returns: undefined
      }
      is_admin_wallet: { Args: { p_wallet: string }; Returns: boolean }
      list_my_contributions: {
        Args: { p_wallet: string }
        Returns: {
          amount_lamports: number
          basis_points: number
          contributed_at: string
          distribution_error: string
          distribution_tx_signature: string
          id: string
          is_fee_claimer: boolean
          launches: Json
          refund_tx_signature: string
          token_amount: number
          token_delivery_wallet: string
          tokens_distributed: boolean
          tx_signature: string
          wallet_address: string
        }[]
      }
      mark_pumpfun_fee_claim_attempt: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_creator_vault_balance: {
        Args: { p_balance_lamports: number; p_launch_ids: string[] }
        Returns: undefined
      }
      record_pumpfun_empty_claim: {
        Args: { p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_fee_claim_failure: {
        Args: { p_error: string; p_launch_id: string }
        Returns: undefined
      }
      record_pumpfun_fee_treasury_sweep: {
        Args: {
          p_amount_lamports: number
          p_launch_id: string
          p_notes?: string
          p_source_wallet: string
          p_treasury_wallet: string
          p_tx_signature: string
        }
        Returns: string
      }
      record_pumpfun_wallet_starved: {
        Args: { p_error: string; p_launch_id: string }
        Returns: undefined
      }
      release_custodial_lock: { Args: { p_key: string }; Returns: boolean }
      release_custodial_row_lock: {
        Args: { p_key: string; p_worker: string }
        Returns: boolean
      }
      reset_all_pumpfun_fee_throttles: { Args: never; Returns: number }
      set_app_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      set_launch_platform_status: {
        Args: { p_admin_wallet: string; p_enabled: boolean; p_platform: string }
        Returns: {
          bags_enabled: boolean
          bags_updated_at: string
          pumpfun_enabled: boolean
          pumpfun_updated_at: string
        }[]
      }
      try_acquire_custodial_lock: { Args: { p_key: string }; Returns: boolean }
      try_acquire_custodial_row_lock: {
        Args: { p_key: string; p_ttl_seconds?: number; p_worker: string }
        Returns: boolean
      }
    }
    Enums: {
      launch_status:
        | "scheduled"
        | "executing"
        | "launched"
        | "execution_failed"
        | "cancelled"
        | "sponsor_pending"
        | "sweep_recovery"
        | "sponsor_pending_funding"
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
        "sponsor_pending",
        "sweep_recovery",
        "sponsor_pending_funding",
      ],
    },
  },
} as const
