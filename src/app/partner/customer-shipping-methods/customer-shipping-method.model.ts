export interface CustomerShippingMethod {
  shipMethodId: number;
  tpId: number;
  custId: number;
  methodName: string;
  carrier: string | null;
  serviceCode: string | null;
  estimatedDelivery: string | null;
  rateType: string;
  flatAmount: number | null;
  paidBy: string | null;
  minOrderAmount: number | null;
  isDefault: 'Y' | 'N';
  status: 'ACTIVE' | 'INACTIVE';
  reqApproval: 'Y' | 'N';
  sortOrder: number;
  createdTs: string;
  createdBy: string | null;
  updatedTs: string;
  updatedBy: string | null;
}

export interface CustomerShippingMethodForm {
  methodName: string;
  carrier: string;
  serviceCode: string;
  estimatedDelivery: string;
  rateType: string;
  flatAmount: number | null;
  paidBy: string;
  minOrderAmount: number | null;
  isDefault: 'Y' | 'N';
  status: 'ACTIVE' | 'INACTIVE';
  reqApproval: 'Y' | 'N';
}
