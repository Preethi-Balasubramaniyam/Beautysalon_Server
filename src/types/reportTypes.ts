export interface ReportConfig {
    source?: string;
    fields?: string[];
    filters?: Filter[];
    group_by?: string;
    sort_by?: Sort;
    aggregation?: Record<string, string>;
    visualization?: 'table' | 'bar_chart' | 'line_chart' | 'pie_chart' | 'series_chart';
    rawQuery?: string; // For MVP: developer-written SQL
}

export interface Filter {
    field: string;
    operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'LIKE';
    value: string | number | boolean | (string | number)[];
}

export interface Sort {
    field: string;
    order: 'asc' | 'desc';
}

export interface IReport {
    id: string;
    orgId: string;
    name: string;
    config: ReportConfig;
    pinned: boolean;
    createdBy: string;
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
  