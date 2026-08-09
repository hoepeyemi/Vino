import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap } from 'lucide-react';
import { calculateProjectedEarnings } from '../../hooks/useStrategyConfig';

interface AmountInputProps {
  depositAmount: string;
  onAmountChange: (amount: string) => void;
  invoiceAmount?: string;
  selectedStrategyAPY: number;
}

export function AmountInput({
  depositAmount,
  onAmountChange,
  invoiceAmount,
  selectedStrategyAPY,
}: AmountInputProps) {
  const showFullAmountTip =
    invoiceAmount &&
    depositAmount !== invoiceAmount &&
    depositAmount !== '';

  return (
    <div className="space-y-4">
      {/* Amount Input */}
      <div className="space-y-2">
        <Label htmlFor="depositAmount">Principal Amount</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <Input
            id="depositAmount"
            type="number"
            placeholder="25000"
            value={depositAmount}
            onChange={(e) => onAmountChange(e.target.value)}
            className="pl-7 border-[#1f1f1f] text-lg font-semibold"
          />
        </div>
        {showFullAmountTip && (
          <p className="text-xs text-muted-foreground">
            Tip: Depositing the full invoice amount (${invoiceAmount}) maximizes
            yield.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          No lockup — withdraw your funds anytime.
        </p>
      </div>

      {/* Projected Earnings Calculator */}
      <div className="rounded border border-[#10b981]/20 bg-[#10b981]/5 p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2 text-[#e5e5e5]">
          <Zap className="w-4 h-4 text-[#10b981]" />
          Projected Earnings (estimated)
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">30 Days</p>
            <p className="text-xl font-bold text-[#10b981]">
              ~${calculateProjectedEarnings(depositAmount, selectedStrategyAPY, 30)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">90 Days</p>
            <p className="text-xl font-bold text-[#10b981]">
              ~${calculateProjectedEarnings(depositAmount, selectedStrategyAPY, 90)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">1 Year</p>
            <p className="text-xl font-bold text-[#10b981]">
              ~${calculateProjectedEarnings(depositAmount, selectedStrategyAPY, 365)}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Based on current APY. Actual yield may vary.
        </p>
      </div>
    </div>
  );
}
