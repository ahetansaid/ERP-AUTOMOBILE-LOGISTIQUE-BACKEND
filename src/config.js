export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'change-me-in-production-erp-2025';
export const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh-in-production-erp-2025';
export const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';   // 900 s
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'COMPTABLE', 'AGENT_TRANSIT', 'COMMERCIAL', 'CLIENT'];
export const VEHICLE_STATUSES = ['ACHETE', 'EN_TRANSIT', 'ARRIVE_PORT', 'EN_DOUANE', 'DEDOUANE', 'LIVRE', 'VENDU'];
export const DOCUMENT_TYPES = ['BL', 'FACTURE_ACHAT', 'QUITTANCE', 'FACTURE_MECEF', 'PROFORMA', 'PHOTO', 'AUTRE'];
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';
