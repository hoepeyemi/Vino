# vino Contracts Makefile

.PHONY: help setup build test clean deploy-local deploy-factory deploy-multichain

help:
	@echo "vino Contracts"
	@echo ""
	@echo "Setup:"
	@echo "  make setup          - Install dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make build          - Compile contracts with Hardhat"
	@echo "  make test           - Run Hardhat tests"
	@echo "  make clean          - Remove Hardhat build output"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-local    - Deploy core contracts on Hardhat network"
	@echo "  make deploy-factory  - Deploy via VinoFactory"
	@echo "  make deploy-multichain - Deploy with optional Pyth/Aave config"

setup:
	npm install

build:
	npm run build

test:
	npm test

clean:
	npm run clean

deploy-local:
	npm run deploy:local

deploy-factory:
	npm run deploy:factory

deploy-multichain:
	npm run deploy:multichain
