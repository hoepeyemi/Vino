import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Radio } from 'lucide-react';
import type { StrategyConfig } from '../../hooks/useStrategyConfig';
import type { StrategyType } from '../../hooks/useDepositFlow';

interface StrategySelectorProps {
  strategies: StrategyConfig[];
  selectedStrategy: StrategyType;
  onSelectStrategy: (strategy: StrategyType) => void;
}

export function StrategySelector({
  strategies,
  selectedStrategy,
  onSelectStrategy,
}: StrategySelectorProps) {
  return (
    <div className="space-y-3">
      <Label className="text-base">Select Strategy</Label>
      <div className="grid grid-cols-1 gap-3">
        {strategies.map((strategy) => {
          const Icon = strategy.icon;
          const isSelected = selectedStrategy === strategy.id;

          return (
            <div
              key={strategy.id}
              className={`rounded border p-4 cursor-pointer transition-all ${
                isSelected
                  ? 'border-[#10b981] bg-[#10b981]/10'
                  : 'border-[#1f1f1f] hover:border-[#10b981]/40'
              }`}
              onClick={() => onSelectStrategy(strategy.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-lg border border-[#10b981]/20 bg-[#10b981]/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{strategy.name}</h3>
                        {strategy.isLive && (
                          <Badge
                            variant="outline"
                            className="border-success/30 bg-success/10 text-success text-xs flex items-center gap-1"
                          >
                            <Radio className="w-2 h-2 animate-pulse" />
                            Live
                          </Badge>
                        )}
                        {strategy.recommended && (
                          <Badge
                            variant="outline"
                            className="border-primary/30 bg-primary/10 text-primary text-xs"
                          >
                            Recommended
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{strategy.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 ml-13">
                    <div>
                      <span className="text-2xl font-bold text-success">{strategy.apy}</span>
                      <span className="text-sm text-muted-foreground ml-1">APY</span>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Risk: </span>
                      <span className="text-sm font-medium">{strategy.risk}</span>
                    </div>
                  </div>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? 'border-primary bg-primary' : 'border-muted'
                  }`}
                >
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
