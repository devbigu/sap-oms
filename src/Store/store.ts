import { create } from "zustand";

export type CartItem = {
  id: string;
  name: string;
  price: number;     // per-pack discounted price
  quantity: number;  // number of packs
  packSize?: number;  // units per pack
  stock?: number;
  isPriority?: boolean;
  image?: string;
};

type CartStore = {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity"> & { initialQty?: number }) => void;
  removeFromCart: (id: string) => void;
  incrementQty: (id: string) => void;
  decrementQty: (id: string) => void;
  togglePriority: (id: string) => void;
  clearCart: () => void;
};

export const useCartStore = create<CartStore>((set) => ({
  cart: [],

  addToCart: (item) =>
    set((state) => {
      const existing = state.cart.find((i) => i.id === item.id);
      const addQty = item.initialQty ?? 1;

      if (existing) {
        return {
          cart: state.cart.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  price: item.price,
                  packSize: item.packSize,
                  image: item.image || i.image,
                  quantity: i.stock
                    ? Math.min(i.quantity + addQty, i.stock)
                    : i.quantity + addQty,
                }
              : i
          ),
        };
      }

      return {
        cart: [
          ...state.cart,
          {
            id: item.id,
            name: item.name,
            price: item.price,
            packSize: item.packSize,
            stock: item.stock,
            isPriority: item.isPriority ?? false,
            image: item.image,
            quantity: item.stock ? Math.min(addQty, item.stock) : addQty,
          },
        ],
      };
    }),

  incrementQty: (id) =>
    set((state) => ({
      cart: state.cart.map((i) =>
        i.id === id
          ? { ...i, quantity: i.stock ? Math.min(i.quantity + 1, i.stock) : i.quantity + 1 }
          : i
      ),
    })),

  decrementQty: (id) =>
    set((state) => ({
      cart: state.cart
        .map((i) => (i.id === id ? { ...i, quantity: Math.max(0, i.quantity - 1) } : i))
        .filter((i) => i.quantity > 0),
    })),

  removeFromCart: (id) =>
    set((state) => ({ cart: state.cart.filter((i) => i.id !== id) })),

  togglePriority: (id) =>
    set((state) => ({
      cart: state.cart.map((i) =>
        i.id === id ? { ...i, isPriority: !i.isPriority } : i
      ),
    })),

  clearCart: () => set({ cart: [] }),
}));
