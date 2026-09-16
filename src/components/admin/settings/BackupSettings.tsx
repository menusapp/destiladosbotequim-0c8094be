import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listObjects as storageList,
  uploadObject as storageUpload,
  downloadObject as storageDownload,
} from "@/lib/restaurantStorage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/sonner";
import { Download, Upload, Cloud, HardDrive, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";

import { novoId } from "@/lib/uuid";
interface BackupSettingsProps {
  restaurantId: string;
}

interface BackupPreview {
  date: string;
  products: number;
  categories: number;
  customers: number;
  tables: number;
  stockItems: number;
  suppliers: number;
}

const BACKUP_TABLES_FULL = [
  "products", "categories", "product_extras", "extra_categories", "extra_category_items",
  "customers", "tables", "stock_items", "stock_categories", "suppliers",
  "delivery_config", "delivery_zones", "business_hours", "payment_methods",
  "whatsapp_config", "fiscal_configs", "loyalty_programs", "loyalty_program_rewards",
  "coupons", "reservation_tables", "reservation_hours", "printer_settings",
  "card_fees_config", "fixed_costs", "variable_costs", "labor_costs",
  "product_variations", "kiosk_config", "extra_category_item_ingredients",
  "product_ingredients", "product_extra_ingredients",
] as const;

const BACKUP_TABLES_ESSENTIAL = [
  "products", "categories", "product_extras", "extra_categories", "extra_category_items",
  "customers", "tables", "stock_items", "stock_categories", "suppliers",
  "delivery_config", "delivery_zones", "business_hours", "payment_methods",
  "whatsapp_config", "fiscal_configs", "loyalty_programs", "loyalty_program_rewards",
  "coupons", "reservation_tables", "reservation_hours", "printer_settings",
] as const;

// FK mapping: for each table, which columns reference other tables' IDs
const FK_MAP: Record<string, Record<string, string>> = {
  products: { category_id: "categories" },
  product_extras: { product_id: "products", extra_category_id: "extra_categories" },
  extra_category_items: { category_id: "extra_categories" },
  extra_category_item_ingredients: { category_item_id: "extra_category_items", stock_item_id: "stock_items" },
  product_ingredients: { product_id: "products", stock_item_id: "stock_items" },
  product_extra_ingredients: { product_extra_id: "product_extras", stock_item_id: "stock_items" },
  stock_items: { stock_category_id: "stock_categories" },
  product_variations: { product_id: "products" },
  loyalty_program_rewards: { program_id: "loyalty_programs", reward_product_id: "products", reward_extra_id: "product_extras" },
  coupons: { target_product_id: "products", target_product_extra_id: "product_extras", target_extra_id: "extra_category_items" },
  delivery_zones: {},
  business_hours: {},
};

// Singleton config tables (one row per restaurant, use delete+insert)
const SINGLETON_TABLES = [
  "delivery_config", "whatsapp_config", "fiscal_configs", "kiosk_config", "printer_settings",
  "card_fees_config",
];

// Restoration phases in dependency order
const RESTORE_PHASES: { label: string; tables: string[] }[] = [
  { label: "Limpando dados existentes...", tables: [] },
  { label: "Restaurando categorias e grupos...", tables: ["categories", "extra_categories", "stock_categories", "suppliers"] },
  { label: "Restaurando produtos, insumos e mesas...", tables: ["products", "stock_items", "tables", "payment_methods"] },
  { label: "Restaurando complementos e variações...", tables: ["product_extras", "extra_category_items", "delivery_zones", "product_variations"] },
  { label: "Restaurando vínculos de insumos...", tables: ["product_ingredients", "product_extra_ingredients", "extra_category_item_ingredients"] },
  { label: "Restaurando programas de fidelidade...", tables: ["loyalty_programs"] },
  { label: "Restaurando recompensas e cupons...", tables: ["loyalty_program_rewards", "coupons"] },
  { label: "Restaurando configurações...", tables: ["business_hours", "delivery_config", "whatsapp_config", "fiscal_configs", "kiosk_config", "printer_settings", "reservation_hours", "reservation_tables"] },
  { label: "Restaurando custos, clientes e taxas...", tables: ["fixed_costs", "variable_costs", "labor_costs", "card_fees_config", "customers"] },
];

export default function BackupSettings({ restaurantId }: BackupSettingsProps) {
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState("");
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [cloudBackups, setCloudBackups] = useState<{ name: string; created_at: string }[]>([]);
  const [loadingCloud, setLoadingCloud] = useState(true);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [pendingRestore, setPendingRestore] = useState<any>(null);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [lastBackupDate, setLastBackupDate] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState(() => localStorage.getItem(`backupPath_${restaurantId}`) || "");

  useEffect(() => {
    fetchCloudBackups();
    const stored = localStorage.getItem(`lastBackup_${restaurantId}`);
    if (stored) setLastBackupDate(stored);
  }, [restaurantId]);

  const saveBackupPath = (path: string) => {
    setBackupPath(path);
    localStorage.setItem(`backupPath_${restaurantId}`, path);
  };

  const supportsFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const fetchCloudBackups = async () => {
    setLoadingCloud(true);
    try {
      const items = await storageList("backups", `${restaurantId}`, 7);
      setCloudBackups(
        items
          .filter((f) => f.name.endsWith(".json"))
          .map((f) => ({ name: f.name, created_at: f.created_at || "" })),
      );
    } catch (err) {
      console.error("Error fetching cloud backups:", err);
    } finally {
      setLoadingCloud(false);
    }
  };

  const fetchBackupData = async (tables: readonly string[]) => {
    const data: Record<string, any[]> = {};

    const { data: categories } = await supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId);
    data.categories = categories || [];

    const categoryIds = (categories || []).map(c => c.id);

    for (const table of tables) {
      if (table === "categories") continue;
      if (table === "products" && categoryIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("*")
          .in("category_id", categoryIds);
        data.products = products || [];
        continue;
      }
      if (table === "product_extras") {
        const productIds = (data.products || []).map(p => p.id);
        if (productIds.length > 0) {
          const { data: extras } = await supabase
            .from("product_extras")
            .select("*")
            .in("product_id", productIds);
          data.product_extras = extras || [];
        } else {
          data.product_extras = [];
        }
        continue;
      }
      if (table === "extra_category_items") {
        const catIds = (data.extra_categories || []).map(c => c.id);
        if (catIds.length > 0) {
          const { data: items } = await supabase
            .from("extra_category_items")
            .select("*")
            .in("category_id", catIds);
          data.extra_category_items = items || [];
        } else {
          data.extra_category_items = [];
        }
        continue;
      }
      if (table === "extra_category_item_ingredients") {
        const itemIds = (data.extra_category_items || []).map(i => i.id);
        if (itemIds.length > 0) {
          const { data: ingredients } = await supabase
            .from("extra_category_item_ingredients")
            .select("*")
            .in("category_item_id", itemIds);
          data.extra_category_item_ingredients = ingredients || [];
        } else {
          data.extra_category_item_ingredients = [];
        }
        continue;
      }
      if (table === "product_variations") {
        const productIds = (data.products || []).map(p => p.id);
        if (productIds.length > 0) {
          const { data: variations } = await supabase
            .from("product_variations" as any)
            .select("*")
            .in("product_id", productIds);
          data.product_variations = variations || [];
        } else {
          data.product_variations = [];
        }
        continue;
      }
      if (table === "product_ingredients") {
        const productIds = (data.products || []).map((p: any) => p.id);
        if (productIds.length > 0) {
          const { data: ingredients } = await supabase
            .from("product_ingredients")
            .select("*")
            .in("product_id", productIds);
          data.product_ingredients = ingredients || [];
        } else {
          data.product_ingredients = [];
        }
        continue;
      }
      if (table === "product_extra_ingredients") {
        const extraIds = (data.product_extras || []).map((e: any) => e.id);
        if (extraIds.length > 0) {
          const { data: ingredients } = await supabase
            .from("product_extra_ingredients")
            .select("*")
            .in("product_extra_id", extraIds);
          data.product_extra_ingredients = ingredients || [];
        } else {
          data.product_extra_ingredients = [];
        }
        continue;
      }
      if (table === "loyalty_program_rewards") {
        const programIds = (data.loyalty_programs || []).map((p: any) => p.id);
        if (programIds.length > 0) {
          const { data: rewards } = await supabase
            .from("loyalty_program_rewards")
            .select("*")
            .in("program_id", programIds);
          data.loyalty_program_rewards = rewards || [];
        } else {
          data.loyalty_program_rewards = [];
        }
        continue;
      }

      try {
        const { data: tableData } = await supabase
          .from(table as any)
          .select("*")
          .eq("restaurant_id", restaurantId);
        data[table] = tableData || [];
      } catch {
        data[table] = [];
      }
    }

    return data;
  };

  const handleDownloadBackup = async () => {
    setDownloading(true);
    try {
      const data = await fetchBackupData(BACKUP_TABLES_FULL);

      const backup = {
        version: "2.0",
        type: "full",
        restaurant_id: restaurantId,
        created_at: new Date().toISOString(),
        data,
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const fileName = `backup_${restaurantId}_${format(new Date(), "yyyy-MM-dd_HH-mm")}.json`;

      if (supportsFileSystemAccess) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();

          const now = new Date().toISOString();
          localStorage.setItem(`lastBackup_${restaurantId}`, now);
          setLastBackupDate(now);
          toast.success("Backup salvo na pasta escolhida!");
          setDownloading(false);
          return;
        } catch (fsErr: any) {
          if (fsErr.name === 'AbortError') {
            setDownloading(false);
            return;
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      const now = new Date().toISOString();
      localStorage.setItem(`lastBackup_${restaurantId}`, now);
      setLastBackupDate(now);
      toast.success("Backup local baixado com sucesso!");
    } catch (err) {
      console.error("Backup error:", err);
      toast.error("Erro ao gerar backup");
    } finally {
      setDownloading(false);
    }
  };

  const handleCloudBackup = async () => {
    setDownloading(true);
    try {
      const data = await fetchBackupData(BACKUP_TABLES_ESSENTIAL);

      const backup = {
        version: "2.0",
        type: "essential",
        restaurant_id: restaurantId,
        created_at: new Date().toISOString(),
        data,
      };

      const fileName = `${format(new Date(), "yyyy-MM-dd_HH-mm")}.json`;
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });

      await storageUpload("backups", `${restaurantId}/${fileName}`, blob, "application/json");

      toast.success("Backup em cloud salvo com sucesso!");
      fetchCloudBackups();
    } catch (err) {
      console.error("Cloud backup error:", err);
      toast.error("Erro ao salvar backup em cloud");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadCloudBackup = async (fileName: string) => {
    try {
      const blob = await storageDownload("backups", `${restaurantId}/${fileName}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cloud_backup_${fileName}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Erro ao baixar backup");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.data || !backup.restaurant_id) {
        toast.error("Arquivo de backup inválido");
        setUploading(false);
        return;
      }

      const preview: BackupPreview = {
        date: backup.created_at || "Desconhecida",
        products: backup.data.products?.length || 0,
        categories: backup.data.categories?.length || 0,
        customers: backup.data.customers?.length || 0,
        tables: backup.data.tables?.length || 0,
        stockItems: backup.data.stock_items?.length || 0,
        suppliers: backup.data.suppliers?.length || 0,
      };

      setBackupPreview(preview);
      setPendingRestore(backup);
    } catch (err) {
      toast.error("Erro ao ler arquivo de backup");
    } finally {
      setUploading(false);
    }
  };

  const handleRestore = async () => {
    if (!pendingRestore) return;
    setRestoring(true);
    setShowConfirmRestore(false);
    setRestoreProgress(0);
    setRestoreStatus("Iniciando restauração...");

    try {
      const backupData = pendingRestore.data;
      const idMap: Record<string, string> = {};
      const counts: Record<string, number> = {};
      // O supabase-js NÃO lança exceção em erro: devolve { error }. Antes o
      // insert ficava dentro de um try/catch que nunca disparava, e a tabela
      // era contada como restaurada mesmo tendo falhado — dava para ver
      // "Restauração concluída" com o banco vazio. Agora cada falha é
      // registrada e mostrada.
      const falhas: { tabela: string; erro: string }[] = [];
      const registrarFalha = (tabela: string, erro: string) => {
        // uma entrada por tabela: 37 produtos falhando pelo mesmo motivo
        // viram 37 linhas iguais e escondem o resto.
        if (!falhas.some((f) => f.tabela === tabela)) falhas.push({ tabela, erro });
      };
      const totalPhases = RESTORE_PHASES.length;

      // Helper: remap a record's FKs and generate new ID
      const remapRecord = (record: any, tableName: string): any => {
        const mapped = { ...record };
        // Generate new ID
        const oldId = mapped.id;
        const newId = novoId();
        idMap[oldId] = newId;
        mapped.id = newId;
        // Set restaurant_id to current
        if ('restaurant_id' in mapped) {
          mapped.restaurant_id = restaurantId;
        }
        // Remap foreign keys
        const fks = FK_MAP[tableName];
        if (fks) {
          for (const [col, _refTable] of Object.entries(fks)) {
            if (mapped[col] && idMap[mapped[col]]) {
              mapped[col] = idMap[mapped[col]];
            } else if (mapped[col] && !idMap[mapped[col]]) {
              // FK points to an ID not in our map — set to null to avoid FK violation
              mapped[col] = null;
            }
          }
        }
        // Remove timestamps to let DB set defaults
        delete mapped.created_at;
        delete mapped.updated_at;
        return mapped;
      };

      // Helper: insert records for a table in batches
      const insertTable = async (tableName: string, records: any[]) => {
        if (!records || records.length === 0) return;
        const isSingleton = SINGLETON_TABLES.includes(tableName);

        if (isSingleton) {
          const { error } = await supabase.from(tableName as any).delete().eq("restaurant_id", restaurantId);
          if (error) registrarFalha(tableName, `limpeza: ${error.message}`);
        }

        let inseridos = 0;
        for (const record of records) {
          const mapped = remapRecord(record, tableName);
          const { error } = await supabase.from(tableName as any).insert(mapped);
          if (error) {
            console.warn(`Falha ao inserir em ${tableName}:`, error);
            registrarFalha(tableName, error.message);
          } else {
            inseridos++;
          }
        }
        // conta o que realmente entrou, não o que foi tentado
        counts[tableName] = inseridos;
      };

      // Phase 0: Clean existing data (reverse dependency order)
      setRestoreStatus(RESTORE_PHASES[0].label);
      setRestoreProgress(Math.round((1 / totalPhases) * 100));

      // Delete in reverse dependency order
      const cleanupOrder = [
        "product_ingredients",
        "product_extra_ingredients",
        "extra_category_item_ingredients",
        "product_variations",
        "loyalty_program_rewards",
        "coupons",
        "product_extras",
        "extra_category_items",
        "products",
        "stock_items",
        "categories",
        "extra_categories",
        "stock_categories",
        "suppliers",
        "tables",
        "payment_methods",
        "loyalty_programs",
        "delivery_zones",
        "business_hours",
        "fixed_costs",
        "variable_costs",
        "labor_costs",
        "customers",
        "reservation_tables",
        "reservation_hours",
      ];

      for (const table of cleanupOrder) {
        if (backupData[table]?.length > 0) {
          try {
            // For tables with restaurant_id
            await supabase.from(table as any).delete().eq("restaurant_id", restaurantId);
          } catch {
            // For tables without restaurant_id or other issues, skip
          }
        }
      }

      // Also clean products/ingredients by category (tables without restaurant_id)
      try {
        const { data: existingCats } = await supabase
          .from("categories")
          .select("id")
          .eq("restaurant_id", restaurantId);
        if (existingCats?.length) {
          const catIds = existingCats.map(c => c.id);
          const { data: existingProds } = await supabase
            .from("products")
            .select("id")
            .in("category_id", catIds);
          if (existingProds?.length) {
            const prodIds = existingProds.map(p => p.id);
            // Clean product ingredients (no restaurant_id)
            await supabase.from("product_ingredients").delete().in("product_id", prodIds);
            // Clean product extras and their ingredients
            const { data: existingExtras } = await supabase
              .from("product_extras")
              .select("id")
              .in("product_id", prodIds);
            if (existingExtras?.length) {
              const extraIds = existingExtras.map(e => e.id);
              await supabase.from("product_extra_ingredients").delete().in("product_extra_id", extraIds);
            }
            await supabase.from("product_extras").delete().in("product_id", prodIds);
            await supabase.from("products").delete().in("category_id", catIds);
          }
          await supabase.from("categories").delete().eq("restaurant_id", restaurantId);
        }
      } catch { /* ignore */ }

      // Phases 1-8: Insert in dependency order
      for (let i = 1; i < RESTORE_PHASES.length; i++) {
        const phase = RESTORE_PHASES[i];
        setRestoreStatus(phase.label);
        setRestoreProgress(Math.round(((i + 1) / totalPhases) * 100));

        for (const tableName of phase.tables) {
          const records = backupData[tableName];
          if (records && records.length > 0) {
            await insertTable(tableName, records);
          }
        }
      }

      // Build summary
      const summaryParts: string[] = [];
      if (counts.categories) summaryParts.push(`${counts.categories} categorias`);
      if (counts.products) summaryParts.push(`${counts.products} produtos`);
      if (counts.product_extras) summaryParts.push(`${counts.product_extras} complementos`);
      if (counts.customers) summaryParts.push(`${counts.customers} clientes`);
      if (counts.tables) summaryParts.push(`${counts.tables} mesas`);
      if (counts.stock_items) summaryParts.push(`${counts.stock_items} insumos`);
      const totalIngredientLinks = (counts.product_ingredients || 0) + (counts.product_extra_ingredients || 0) + (counts.extra_category_item_ingredients || 0);
      if (totalIngredientLinks) summaryParts.push(`${totalIngredientLinks} vínculos de insumos`);
      if (counts.suppliers) summaryParts.push(`${counts.suppliers} fornecedores`);
      if (counts.loyalty_programs) summaryParts.push(`${counts.loyalty_programs} programas de fidelidade`);
      if (counts.coupons) summaryParts.push(`${counts.coupons} cupons`);

      const summary = summaryParts.length > 0
        ? `Restauração concluída: ${summaryParts.join(", ")}.`
        : "Restauração concluída (nenhum dado para importar).";

      setRestoreProgress(100);

      if (falhas.length > 0) {
        console.error("Falhas na restauração:", falhas);
        const detalhe = falhas.map((f) => `${f.tabela}: ${f.erro}`).join(" • ");
        setRestoreStatus(`⚠️ ${summary} Falhou em ${falhas.length} tabela(s) — ${detalhe}`);
        toast.error(`Restauração incompleta. ${falhas[0].tabela}: ${falhas[0].erro}`, { duration: 15000 });
      } else {
        setRestoreStatus("✅ " + summary);
        toast.success(summary);
      }

      setPendingRestore(null);
      setBackupPreview(null);
    } catch (err) {
      console.error("Restore error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Erro ao restaurar backup: " + msg, { duration: 15000 });
      setRestoreStatus("❌ Erro durante a restauração: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Backup e Restauração</h2>
        <p className="text-sm text-muted-foreground">Proteja os dados do seu restaurante com backups regulares</p>
      </div>

      {/* Local Backup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Backup Local</CardTitle>
          </div>
          <CardDescription>
            Baixe um backup completo dos dados do restaurante para o seu computador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Pasta padrão para backup (lembrete)</label>
            <Input
              value={backupPath}
              onChange={e => saveBackupPath(e.target.value)}
              placeholder="Ex: C:\Backups\Menus ou ~/Downloads/backups"
            />
            <p className="text-xs text-muted-foreground">
              {supportsFileSystemAccess
                ? "Ao clicar em \"Baixar Backup\", você poderá escolher a pasta diretamente."
                : "Configure a pasta de download do seu navegador: Configurações → Downloads → Perguntar onde salvar cada arquivo."}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              {lastBackupDate && (
                <p className="text-sm text-muted-foreground">
                  Último backup: {format(new Date(lastBackupDate), "dd/MM/yyyy 'às' HH:mm")}
                </p>
              )}
            </div>
            <Button onClick={handleDownloadBackup} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Baixar Backup Agora
            </Button>
          </div>
          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
            <p>O backup local é salvo no seu computador. Recomendamos armazenar em local seguro como HD externo ou Google Drive.</p>
          </div>
        </CardContent>
      </Card>

      {/* Cloud Backup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Backup em Cloud</CardTitle>
          </div>
          <CardDescription>
            Backup salvo na nuvem com dados essenciais (produtos, clientes, configurações).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {cloudBackups.length} backup(s) disponível(is)
            </p>
            <Button onClick={handleCloudBackup} disabled={downloading} variant="outline">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Cloud className="h-4 w-4 mr-2" />}
              Salvar Backup em Cloud
            </Button>
          </div>

          {cloudBackups.length > 0 && (
            <div className="space-y-2">
              {cloudBackups.map((backup) => (
                <div key={backup.name} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{backup.name}</p>
                    {backup.created_at && (
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(backup.created_at), "dd/MM/yyyy 'às' HH:mm")}
                      </p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleDownloadCloudBackup(backup.name)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
            <p>Backup em cloud salva apenas dados essenciais. Para backup completo incluindo histórico de pedidos, use o backup local.</p>
          </div>
        </CardContent>
      </Card>

      {/* Restore */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Restauração</CardTitle>
          </div>
          <CardDescription>
            Restaure os dados do restaurante a partir de um arquivo de backup.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              disabled={uploading || restoring}
            />
          </div>

          {restoring && (
            <div className="space-y-3 p-4 border border-border rounded-lg">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm font-medium">{restoreStatus}</span>
              </div>
              <Progress value={restoreProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">{restoreProgress}% concluído</p>
            </div>
          )}

          {!restoring && restoreStatus && restoreStatus.startsWith("✅") && (
            <div className="flex items-start gap-2 p-3 bg-green-500/10 rounded-lg text-sm text-green-700 dark:text-green-400">
              <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{restoreStatus.replace("✅ ", "")}</p>
            </div>
          )}

          {!restoring && restoreStatus && restoreStatus.startsWith("❌") && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{restoreStatus.replace("❌ ", "")}</p>
            </div>
          )}

          {backupPreview && !restoring && (
            <div className="p-4 border border-border rounded-lg space-y-3">
              <h4 className="font-semibold text-sm">Preview do Backup</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Data:</span>
                  <span className="font-medium">{backupPreview.date !== "Desconhecida" ? format(new Date(backupPreview.date), "dd/MM/yyyy") : "Desconhecida"}</span>
                </div>
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Produtos:</span>
                  <span className="font-medium">{backupPreview.products}</span>
                </div>
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Categorias:</span>
                  <span className="font-medium">{backupPreview.categories}</span>
                </div>
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Clientes:</span>
                  <span className="font-medium">{backupPreview.customers}</span>
                </div>
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Mesas:</span>
                  <span className="font-medium">{backupPreview.tables}</span>
                </div>
                <div className="flex justify-between p-2 bg-muted/30 rounded">
                  <span className="text-muted-foreground">Insumos:</span>
                  <span className="font-medium">{backupPreview.stockItems}</span>
                </div>
              </div>

              {pendingRestore?.restaurant_id !== restaurantId && (
                <div className="flex items-start gap-2 p-3 bg-yellow-500/10 rounded-lg text-sm text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Este backup é de outro restaurante. Os IDs serão remapeados automaticamente para evitar conflitos.</p>
                </div>
              )}

              <Button
                onClick={() => setShowConfirmRestore(true)}
                disabled={restoring}
                variant="destructive"
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                Restaurar Backup
              </Button>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-lg text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>A restauração substituirá todos os dados atuais. Faça um backup antes de restaurar.</p>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmRestore} onOpenChange={setShowConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Restauração</AlertDialogTitle>
            <AlertDialogDescription>
              Isso substituirá todos os dados atuais do restaurante (produtos, categorias, clientes, mesas, insumos e fornecedores). Essa ação não pode ser desfeita. Tem certeza?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sim, Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
