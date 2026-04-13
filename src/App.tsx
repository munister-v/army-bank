import { useState, useMemo } from 'react';
import { 
  Search, 
  ShoppingCart, 
  User, 
  ChevronDown, 
  Star, 
  Plus, 
  Minus, 
  Trash2, 
  CreditCard, 
  MapPin, 
  TrendingUp, 
  Zap, 
  ShieldCheck,
  Filter,
  ArrowRight,
  Menu,
  X,
  Globe,
  Award,
  Eye,
  ArrowLeftRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// Product image SVGs (embedded, no external deps)
const PRODUCT_IMAGES: Record<string, string> = {
  phone1: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231d4636'/%3E%3Crect x='65' y='20' width='70' height='130' rx='8' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Crect x='72' y='35' width='56' height='90' fill='%231d4636'/%3E%3Ccircle cx='100' cy='138' r='5' fill='%23a8792a'/%3E%3Crect x='85' y='27' width='30' height='3' rx='2' fill='%23a8792a'/%3E%3Ctext x='100' y='85' font-family='monospace' font-size='10' fill='%23a8792a' text-anchor='middle'%3EARM%3C/text%3E%3Ctext x='100' y='98' font-family='monospace' font-size='8' fill='%23ffffff80' text-anchor='middle'%3EPHONE%3C/text%3E%3C/svg%3E`,
  lock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%2324523f'/%3E%3Crect x='55' y='90' width='90' height='75' rx='6' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Cpath d='M70 90 V65 A30 30 0 0 1 130 65 V90' fill='none' stroke='%23fff' stroke-width='8' stroke-linecap='round'/%3E%3Ccircle cx='100' cy='130' r='12' fill='%231d4636'/%3E%3Crect x='97' y='130' width='6' height='15' rx='3' fill='%231d4636'/%3E%3Ccircle cx='100' cy='130' r='6' fill='%23a8792a'/%3E%3Ctext x='100' y='180' font-family='monospace' font-size='9' fill='%23a8792a' text-anchor='middle'%3ESMART LOCK%3C/text%3E%3C/svg%3E`,
  coffee: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231d4636'/%3E%3Crect x='50' y='80' width='80' height='80' rx='5' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Cpath d='M130 95 Q155 95 155 115 Q155 135 130 135' fill='none' stroke='%23a8792a' stroke-width='6' stroke-linecap='round'/%3E%3Crect x='60' y='155' width='100' height='8' rx='4' fill='%23a8792a'/%3E%3Cpath d='M75 75 Q80 60 85 75' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M90 70 Q95 55 100 70' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round'/%3E%3Ctext x='90' y='125' font-family='monospace' font-size='9' fill='%231d4636' text-anchor='middle'%3ECOFFEE%3C/text%3E%3C/svg%3E`,
  phone2: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23111'/%3E%3Crect x='65' y='25' width='70' height='130' rx='10' fill='%23222' stroke='%23a8792a' stroke-width='2'/%3E%3Crect x='72' y='40' width='56' height='88' fill='%231d4636'/%3E%3Ccircle cx='100' cy='143' r='6' fill='%23333' stroke='%23a8792a' stroke-width='1'/%3E%3Ccircle cx='84' cy='33' r='3' fill='%23444'/%3E%3Crect x='90' y='31' width='20' height='4' rx='2' fill='%23444'/%3E%3Ctext x='100' y='90' font-family='monospace' font-size='11' fill='%23a8792a' text-anchor='middle' font-weight='bold'%3EARM%3C/text%3E%3Ctext x='100' y='104' font-family='monospace' font-size='7' fill='%23ffffff60' text-anchor='middle'%3ESE 128GB%3C/text%3E%3C/svg%3E`,
  plug: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%2324523f'/%3E%3Crect x='65' y='60' width='70' height='70' rx='10' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Crect x='88' y='130' width='24' height='25' rx='4' fill='%23fff' stroke='%23a8792a' stroke-width='2'/%3E%3Ccircle cx='100' cy='95' r='15' fill='%231d4636'/%3E%3Ccircle cx='100' cy='95' r='8' fill='%23a8792a'/%3E%3Crect x='82' y='75' width='5' height='10' rx='2' fill='%231d4636'/%3E%3Crect x='113' y='75' width='5' height='10' rx='2' fill='%231d4636'/%3E%3Ctext x='100' y='175' font-family='monospace' font-size='9' fill='%23a8792a' text-anchor='middle'%3ESMART PLUG%3C/text%3E%3C/svg%3E`,
  tv: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231d4636'/%3E%3Crect x='20' y='45' width='160' height='100' rx='6' fill='%23111' stroke='%23a8792a' stroke-width='3'/%3E%3Crect x='28' y='53' width='144' height='84' fill='%231d4636'/%3E%3Crect x='80' y='145' width='40' height='12' rx='3' fill='%23333'/%3E%3Crect x='55' y='157' width='90' height='6' rx='3' fill='%23444'/%3E%3Ctext x='100' y='100' font-family='monospace' font-size='14' fill='%23a8792a' text-anchor='middle' font-weight='bold'%3E4K%3C/text%3E%3Ctext x='100' y='116' font-family='monospace' font-size='8' fill='%23ffffff60' text-anchor='middle'%3ESMART TV 50%22%3C/text%3E%3C/svg%3E`,
  washer: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%2324523f'/%3E%3Crect x='35' y='30' width='130' height='150' rx='8' fill='%23f0f0f0' stroke='%23a8792a' stroke-width='3'/%3E%3Ccircle cx='100' cy='120' r='45' fill='%23fff' stroke='%231d4636' stroke-width='3'/%3E%3Ccircle cx='100' cy='120' r='30' fill='%231d4636' stroke='%23a8792a' stroke-width='2'/%3E%3Ccircle cx='100' cy='120' r='12' fill='%2324523f'/%3E%3Ccircle cx='100' cy='120' r='5' fill='%23a8792a'/%3E%3Crect x='50' y='48' width='60' height='20' rx='4' fill='%231d4636'/%3E%3Ccircle cx='140' cy='55' r='8' fill='%23a8792a'/%3E%3C/svg%3E`,
  vacuum: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%231d4636'/%3E%3Cellipse cx='100' cy='140' rx='55' ry='25' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Crect x='88' y='50' width='24' height='90' rx='12' fill='%23fff' stroke='%23a8792a' stroke-width='3'/%3E%3Ccircle cx='100' cy='50' r='20' fill='%23a8792a'/%3E%3Ccircle cx='100' cy='50' r='10' fill='%231d4636'/%3E%3Cpath d='M60 140 Q100 120 140 140' fill='none' stroke='%23a8792a' stroke-width='3'/%3E%3Ctext x='100' y='178' font-family='monospace' font-size='8' fill='%231d4636' text-anchor='middle'%3EVACUUM PRO%3C/text%3E%3C/svg%3E`,
  hero: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Crect width='400' height='400' fill='%231d4636'/%3E%3Crect x='130' y='40' width='140' height='260' rx='16' fill='%23fff' stroke='%23a8792a' stroke-width='4'/%3E%3Crect x='144' y='70' width='112' height='178' fill='%231d4636'/%3E%3Ccircle cx='200' cy='276' r='10' fill='%23a8792a'/%3E%3Crect x='170' y='54' width='60' height='6' rx='3' fill='%23a8792a'/%3E%3Ctext x='200' y='165' font-family='monospace' font-size='22' fill='%23a8792a' text-anchor='middle' font-weight='bold'%3EARM%3C/text%3E%3Ctext x='200' y='190' font-family='monospace' font-size='12' fill='%23ffffff80' text-anchor='middle'%3EPHONE ULTRA%3C/text%3E%3C/svg%3E`,
};

// Types
interface Product {
  id: string;
  name: string;
  price: number;
  oldPrice?: number;
  rating: number;
  category: string;
  image: string;
  badge?: 'HOT' | 'NEW' | 'TOP' | 'SALE';
  discount?: number;
  specs?: Record<string, string>;
}

interface CartItem extends Product {
  quantity: number;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

// Mock Data
const PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'ARM Phone Ultra Pro',
    price: 41999,
    oldPrice: 49558,
    rating: 4.1,
    category: 'Смартфони',
    image: PRODUCT_IMAGES.phone1,
    badge: 'HOT',
    discount: 15,
    specs: { 'Екран': '6.7" OLED', 'Пам\'ять': '256GB', 'Батарея': '5000 mAh' }
  },
  {
    id: '2',
    name: 'ARM Door Smart Lock',
    price: 5499,
    oldPrice: 6268,
    rating: 4.7,
    category: 'Товари для дому',
    image: PRODUCT_IMAGES.lock,
    badge: 'NEW',
    discount: 12,
    specs: { 'Тип': 'Розумний', 'Живлення': 'Акумулятор', 'Зв\'язок': 'Wi-Fi/Bluetooth' }
  },
  {
    id: '3',
    name: 'ARM Coffee Pro',
    price: 8499,
    oldPrice: 9603,
    rating: 4.0,
    category: 'Побутова техніка',
    image: PRODUCT_IMAGES.coffee,
    discount: 12,
    specs: { 'Потужність': '1450 Вт', 'Тиск': '15 бар', 'Об\'єм': '1.8 л' }
  },
  {
    id: '4',
    name: 'ARM Phone SE 128GB',
    price: 10499,
    oldPrice: 12283,
    rating: 4.6,
    category: 'Смартфони',
    image: PRODUCT_IMAGES.phone2,
    discount: 15,
    specs: { 'Екран': '6.1" IPS', 'Пам\'ять': '128GB', 'Батарея': '3200 mAh' }
  },
  {
    id: '5',
    name: 'ARM Smart Plug Power',
    price: 1299,
    oldPrice: 1499,
    rating: 4.8,
    category: 'Товари для дому',
    image: PRODUCT_IMAGES.plug,
    badge: 'SALE',
    discount: 12,
    specs: { 'Макс. струм': '16А', 'Зв\'язок': 'Wi-Fi', 'Керування': 'Голосове' }
  },
  {
    id: '6',
    name: 'ARM Smart TV 50" 4K',
    price: 18999,
    oldPrice: 21347,
    rating: 4.5,
    category: 'Ноутбуки та комп\'ютери',
    image: PRODUCT_IMAGES.tv,
    badge: 'TOP',
    discount: 11,
    specs: { 'Діагональ': '50"', 'Роздільна здатність': '4K UHD', 'Smart TV': 'Так' }
  },
  {
    id: '7',
    name: 'ARM Washing Machine 8kg',
    price: 14499,
    oldPrice: 16291,
    rating: 4.3,
    category: 'Побутова техніка',
    image: PRODUCT_IMAGES.washer,
    discount: 11,
    specs: { 'Завантаження': '8 кг', 'Віджим': '1200 об/хв', 'Клас': 'A+++' }
  },
  {
    id: '8',
    name: 'ARM Vacuum Upright Pro',
    price: 7999,
    oldPrice: 9522,
    rating: 4.4,
    category: 'Побутова техніка',
    image: PRODUCT_IMAGES.vacuum,
    badge: 'SALE',
    discount: 16,
    specs: { 'Тип': 'Акумуляторний', 'Час роботи': '60 хв', 'Потужність': '150 Вт' }
  }
];

const CATEGORIES = [
  'Усі товари',
  'Ноутбуки та комп\'ютери',
  'Смартфони',
  'Побутова техніка',
  'Товари для дому',
  'Акції ARM'
];

export default function App() {
  const [activeCategory, setActiveCategory] = useState('Усі товари');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [compareList, setCompareList] = useState<Product[]>([]);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState('popular'); // popular, price-asc, price-desc
  
  // Filter state
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);

  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // Derived state
  const filteredProducts = useMemo(() => {
    let result = PRODUCTS.filter(p => {
      const matchesCategory = activeCategory === 'Усі товари' || p.category === activeCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesMinPrice = minPrice === '' || p.price >= parseInt(minPrice);
      const matchesMaxPrice = maxPrice === '' || p.price <= parseInt(maxPrice);
      const matchesStock = !inStockOnly || p.badge !== 'OUT_OF_STOCK';
      return matchesCategory && matchesSearch && matchesMinPrice && matchesMaxPrice && matchesStock;
    });

    if (sortBy === 'price-asc') result.sort((a, b) => a.price - b.price);
    if (sortBy === 'price-desc') result.sort((a, b) => b.price - a.price);
    if (sortBy === 'popular') result.sort((a, b) => b.rating - a.rating);

    return result;
  }, [activeCategory, searchQuery, sortBy]);

  const cartTotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [cart]);

  const cartCount = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Actions
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    addToast(`"${product.name}" додано до кошика`, 'success');
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === productId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const toggleCompare = (product: Product) => {
    setCompareList(prev => {
      if (prev.find(p => p.id === product.id)) {
        addToast(`"${product.name}" видалено з порівняння`, 'info');
        return prev.filter(p => p.id !== product.id);
      }
      if (prev.length >= 4) {
        addToast('Можна порівнювати не більше 4 товарів', 'error');
        return prev;
      }
      addToast(`"${product.name}" додано до порівняння`, 'success');
      return [...prev, product];
    });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      setIsLoggedIn(true);
      setIsAuthModalOpen(false);
      addToast('Авторизація успішна. Вітаємо!', 'success');
    }, 1500);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setIsProfileOpen(false);
    addToast('Ви вийшли з системи', 'info');
  };

  const handleCheckout = () => {
    setIsCheckingOut(true);
    setTimeout(() => {
      setIsCheckingOut(false);
      setCart([]);
      setIsCartOpen(false);
      addToast('Замовлення успішно оформлено!', 'success');
    }, 2000);
  };

  const allCompareSpecKeys = useMemo(() => {
    return Array.from(new Set(compareList.flatMap(p => Object.keys(p.specs || {}))));
  }, [compareList]);

  return (
    <div className="min-h-screen flex flex-col bg-surface selection:bg-accent selection:text-white relative">
      {/* Header */}
      <header className="border-b-2 border-black sticky top-0 z-50 bg-surface/90 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-20 flex items-center justify-between gap-8">
          {/* Logo */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="w-12 h-12 bg-black flex items-center justify-center text-accent font-black text-2xl border-2 border-black relative group">
              ARM
              <div className="absolute -bottom-2 -right-2 w-full h-full bg-accent -z-10 border-2 border-black group-hover:translate-x-1 group-hover:translate-y-1 transition-transform"></div>
            </div>
            <div className="hidden md:block">
              <h1 className="text-2xl leading-none tracking-tighter">MARKET</h1>
              <p className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase">SYS.VER.2.0.4</p>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            {CATEGORIES.slice(0, 4).map(cat => (
              <button 
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "text-xs font-black uppercase tracking-widest hover:text-accent transition-colors",
                  activeCategory === cat ? "text-accent" : "text-black"
                )}
              >
                {cat}
              </button>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-4">
            <button className="hidden sm:flex items-center gap-2 text-xs font-black uppercase tracking-widest hover:opacity-70 transition-opacity">
              <Globe className="w-4 h-4" /> UA
            </button>
            <button 
              onClick={() => isLoggedIn ? setIsProfileOpen(true) : setIsAuthModalOpen(true)}
              className="relative group"
            >
              <div className={cn(
                "w-12 h-12 border-2 border-black flex items-center justify-center transition-all",
                isLoggedIn ? "bg-accent text-white" : "group-hover:bg-accent group-hover:text-white"
              )}>
                <User className="w-5 h-5" />
              </div>
            </button>
            <button 
              onClick={() => setIsCompareModalOpen(true)}
              className="relative group"
            >
              <div className="w-12 h-12 border-2 border-black flex items-center justify-center group-hover:bg-accent group-hover:text-black transition-all">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              {compareList.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-black text-white text-[10px] font-black px-1.5 py-0.5 border-2 border-black">
                  {compareList.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setIsCartOpen(true)}
              className="relative group"
            >
              <div className="w-12 h-12 border-2 border-black flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
                <ShoppingCart className="w-5 h-5" />
              </div>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-accent text-black text-[10px] font-black px-1.5 py-0.5 border-2 border-black">
                  {cartCount}
                </span>
              )}
            </button>
            <button 
              className="lg:hidden w-12 h-12 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-all"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, x: '100%' }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: '100%' }}
            className="fixed inset-0 bg-white z-[60] pt-20 px-8"
          >
            <div className="flex flex-col gap-6">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCategory(cat);
                    setIsMobileMenuOpen(false);
                  }}
                  className="text-4xl font-black uppercase tracking-tighter text-left hover:text-accent transition-colors"
                >
                  {cat}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1">
        {/* Hero Section - Bento Grid Style */}
        <section className="border-b-2 border-black bg-black text-white p-4 sm:p-8 overflow-hidden relative">
          <div className="max-w-[1440px] mx-auto relative z-10">
            <div className="grid lg:grid-cols-[1fr_400px] gap-4 items-stretch min-h-[600px]">
              
              {/* Main Typographic Block */}
              <div className="border-2 border-white/20 p-8 md:p-12 flex flex-col justify-between relative overflow-hidden group bg-[#1d4636]/50 backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-64 h-64 bg-accent/20 blur-[100px] rounded-full group-hover:bg-accent/40 transition-colors duration-1000"></div>
                
                <div className="space-y-6 relative z-20">
                  <div className="inline-flex items-center gap-3 border border-white/20 px-4 py-2 text-[10px] font-mono font-bold uppercase tracking-[0.2em] bg-black/50 backdrop-blur-md">
                    <span className="w-2 h-2 bg-accent animate-pulse rounded-full"></span>
                    SYSTEM.ONLINE // SECURE.TX.ACTIVE
                  </div>
                  <h2 className="text-5xl sm:text-7xl lg:text-8xl font-black leading-[0.85] tracking-tighter uppercase">
                    Апаратний <br /> 
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-white">
                      Абсолют
                    </span> <br /> 
                    Досягнуто
                  </h2>
                </div>

                <div className="mt-12 flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between relative z-20">
                  <div className="font-mono text-xs text-white/70 border-l-2 border-accent pl-4 py-1 max-w-sm">
                    [ DATA.STREAM.ACTIVE ]<br/>
                    Протокол забезпечення елітним обладнанням.<br/>
                    Миттєва авторизація транзакцій.
                  </div>
                  <button className="u24-button bg-accent text-black border-accent hover:bg-white hover:text-black hover:border-white shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]">
                    До каталогу <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Right Side Bento Blocks */}
              <div className="grid grid-rows-2 gap-4">
                {/* Featured Product Block */}
                <div className="border-2 border-white/20 p-8 relative overflow-hidden flex flex-col justify-between bg-gradient-to-br from-[#24523f] to-black group">
                  <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay"></div>
                  <div className="flex justify-between items-start relative z-10">
                    <span className="font-mono text-[10px] font-bold text-accent border border-accent px-2 py-1">FEATURED</span>
                    <span className="font-mono text-[10px] text-white/50">ID.0001</span>
                  </div>
                  <div className="relative z-10 flex-1 flex items-center justify-center py-8">
                    <motion.img 
                      initial={{ rotate: -5, scale: 0.9 }}
                      animate={{ rotate: 5, scale: 1 }}
                      transition={{ repeat: Infinity, repeatType: "reverse", duration: 4, ease: "easeInOut" }}
                      src={PRODUCT_IMAGES.hero} 
                      alt="Hero" 
                      className="w-48 h-48 object-cover border-2 border-white/20 shadow-2xl grayscale group-hover:grayscale-0 transition-all duration-700"
                                          />
                  </div>
                  <div className="relative z-10 flex justify-between items-end">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-1">ARM Phone Ultra</p>
                      <p className="font-mono text-xl font-black text-accent">₴41,999</p>
                    </div>
                    <button className="w-10 h-10 border border-white/20 flex items-center justify-center hover:bg-accent hover:text-black hover:border-accent transition-colors">
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Promo Block */}
                <div className="border-2 border-white/20 p-8 bg-accent text-black flex flex-col justify-center relative overflow-hidden">
                  <div className="absolute -right-10 -bottom-10 text-[120px] font-black opacity-10 leading-none pointer-events-none">
                    10%
                  </div>
                  <h3 className="text-3xl font-black uppercase tracking-tighter leading-none mb-4">
                    Кешбек <br/> На Все
                  </h3>
                  <p className="text-xs font-bold uppercase tracking-widest opacity-80 max-w-[200px]">
                    Оплачуйте карткою ARM Bank та отримуйте миттєвий кешбек.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Stats / Info Bar */}
        <section className="border-b-2 border-black grid grid-cols-1 md:grid-cols-3 bg-surface relative z-10">
          <div className="p-6 md:p-8 border-b-2 md:border-b-0 md:border-r-2 border-black flex items-center gap-6 group hover:bg-accent transition-colors relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-8xl font-black text-black/5 group-hover:text-black/10 transition-colors pointer-events-none">01</div>
            <div className="text-4xl font-mono font-black">01</div>
            <div className="relative z-10">
              <h4 className="text-sm font-black uppercase tracking-widest mb-1">Безпека</h4>
              <p className="text-[10px] font-mono font-bold text-slate-500 group-hover:text-black transition-colors">SYS.SECURE.TX</p>
            </div>
          </div>
          <div className="p-6 md:p-8 border-b-2 md:border-b-0 md:border-r-2 border-black flex items-center gap-6 group hover:bg-accent transition-colors relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-8xl font-black text-black/5 group-hover:text-black/10 transition-colors pointer-events-none">02</div>
            <div className="text-4xl font-mono font-black">02</div>
            <div className="relative z-10">
              <h4 className="text-sm font-black uppercase tracking-widest mb-1">Швидкість</h4>
              <p className="text-[10px] font-mono font-bold text-slate-500 group-hover:text-black transition-colors">DELIVERY.24H</p>
            </div>
          </div>
          <div className="p-6 md:p-8 flex items-center gap-6 group hover:bg-accent transition-colors relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-8xl font-black text-black/5 group-hover:text-black/10 transition-colors pointer-events-none">03</div>
            <div className="text-4xl font-mono font-black">03</div>
            <div className="relative z-10">
              <h4 className="text-sm font-black uppercase tracking-widest mb-1">Вигода</h4>
              <p className="text-[10px] font-mono font-bold text-slate-500 group-hover:text-black transition-colors">0%_INSTALLMENT</p>
            </div>
          </div>
        </section>

        {/* Catalog Section */}
        <section className="max-w-[1440px] mx-auto px-4 sm:px-8 py-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
            <div className="space-y-4">
              <h3 className="text-5xl sm:text-7xl font-black tracking-tighter uppercase leading-none">
                Каталог <br /> <span className="text-slate-300">Товарів</span>
              </h3>
            </div>
          </div>

          {/* Brutalist Filter Bar */}
          <div className="sticky top-20 z-40 bg-surface border-2 border-black mb-12 flex flex-col lg:flex-row shadow-[8px_8px_0px_0px_#1d4636] backdrop-blur-md">
            {/* Search */}
            <div className="flex-1 flex items-center border-b-2 lg:border-b-0 lg:border-r-2 border-black">
              <div className="pl-6 pr-4">
                <Search className="w-6 h-6 text-black" />
              </div>
              <input 
                type="text" 
                placeholder="ПОШУК ТОВАРІВ..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full py-6 pr-6 bg-transparent outline-none font-black uppercase tracking-widest text-sm placeholder:text-slate-400"
              />
            </div>
            
            {/* Categories Scroll */}
            <div className="flex-1 overflow-x-auto flex items-center border-b-2 lg:border-b-0 lg:border-r-2 border-black scrollbar-hide">
              <div className="flex px-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={cn(
                      "px-6 py-6 text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                      activeCategory === cat ? "bg-black text-white" : "hover:bg-slate-100 text-black"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort Dropdown */}
            <div className="relative flex items-center min-w-[200px] bg-slate-50 border-b-2 lg:border-b-0 lg:border-r-2 border-black">
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full h-full py-6 pl-6 pr-12 appearance-none bg-transparent outline-none font-black uppercase tracking-widest text-[10px] cursor-pointer"
              >
                <option value="popular">СПОЧАТКУ ПОПУЛЯРНІ</option>
                <option value="price-asc">ВІД ДЕШЕВИХ ДО ДОРОГИХ</option>
                <option value="price-desc">ВІД ДОРОГИХ ДО ДЕШЕВИХ</option>
              </select>
              <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" />
            </div>

            {/* Filter Toggle */}
            <button 
              onClick={() => setIsFilterExpanded(!isFilterExpanded)}
              className={cn(
                "px-6 py-6 flex items-center justify-center gap-2 font-black uppercase tracking-widest text-[10px] transition-colors",
                isFilterExpanded ? "bg-black text-white" : "hover:bg-slate-100 bg-white text-black"
              )}
            >
              <Filter className="w-4 h-4" />
              Фільтри
            </button>
          </div>

          {/* Expanded Filter Panel */}
          <AnimatePresence>
            {isFilterExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mb-12"
              >
                <div className="border-2 border-black bg-white p-8 shadow-[8px_8px_0px_0px_#1d4636]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Price Range */}
                    <div className="space-y-4">
                      <h4 className="font-black uppercase tracking-widest text-xs">Ціна (₴)</h4>
                      <div className="flex items-center gap-4">
                        <input 
                          type="number" 
                          placeholder="Від" 
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value)}
                          className="w-full p-3 border-2 border-black text-sm font-bold outline-none focus:bg-slate-50"
                        />
                        <span className="font-black">-</span>
                        <input 
                          type="number" 
                          placeholder="До" 
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value)}
                          className="w-full p-3 border-2 border-black text-sm font-bold outline-none focus:bg-slate-50"
                        />
                      </div>
                    </div>

                    {/* Availability */}
                    <div className="space-y-4">
                      <h4 className="font-black uppercase tracking-widest text-xs">Наявність</h4>
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <div className={cn(
                          "w-6 h-6 border-2 border-black flex items-center justify-center transition-colors",
                          inStockOnly ? "bg-accent border-accent text-white" : "bg-white group-hover:bg-slate-100"
                        )}>
                          {inStockOnly && <div className="w-3 h-3 bg-white"></div>}
                        </div>
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={inStockOnly}
                          onChange={(e) => setInStockOnly(e.target.checked)}
                        />
                        <span className="font-bold text-sm uppercase tracking-widest">Тільки в наявності</span>
                      </label>
                    </div>

                    {/* Reset */}
                    <div className="flex items-end justify-end">
                      <button 
                        onClick={() => { setMinPrice(''); setMaxPrice(''); setInStockOnly(false); }}
                        className="text-[10px] font-black uppercase tracking-widest underline hover:text-accent transition-colors"
                      >
                        Скинути фільтри
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Grid */}
          {filteredProducts.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center border-2 border-black bg-surface">
              <div className="text-6xl mb-6 opacity-50">📡</div>
              <h3 className="text-3xl font-black uppercase tracking-tighter mb-2">Сигнал втрачено</h3>
              <p className="text-sm font-bold text-slate-500 uppercase tracking-widest max-w-md mx-auto">
                За вашими критеріями не знайдено жодного пристрою. Спробуйте змінити параметри фільтрації.
              </p>
              <button 
                onClick={() => { setMinPrice(''); setMaxPrice(''); setInStockOnly(false); setSearchQuery(''); setActiveCategory('Усі товари'); }}
                className="mt-8 u24-button-outline"
              >
                Скинути всі фільтри
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
              {filteredProducts.map(product => (
                <motion.div
                  layout
                  key={product.id}
                  className="u24-card group"
                >
                {/* Tech Header */}
                <div className="p-4 border-b-2 border-black flex justify-between items-center bg-surface">
                  <span className="font-mono text-[10px] font-bold text-slate-500">ID.{product.id.padStart(4, '0')}</span>
                  {product.badge ? (
                    <span className="font-mono text-[10px] font-bold bg-accent text-white px-2 py-0.5">{product.badge}</span>
                  ) : (
                    <span className="font-mono text-[10px] font-bold bg-black text-white px-2 py-0.5">IN_STOCK</span>
                  )}
                </div>

                {/* Image Area */}
                <div className="relative aspect-square overflow-hidden bg-surface border-b-2 border-black p-6 flex items-center justify-center">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(29,70,54,0.05)_0%,transparent_70%)] pointer-events-none"></div>
                  <img 
                    src={product.image} 
                    alt={product.name} 
                    className="w-full h-full object-cover drop-shadow-xl group-hover:scale-110 transition-transform duration-700"
                    referrerPolicy="no-referrer" 
                  />
                  
                  {/* Hover Action Overlay */}
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-4">
                    <button 
                      onClick={() => setQuickViewProduct(product)}
                      className="w-12 h-12 bg-white text-black flex items-center justify-center hover:bg-accent hover:text-white transition-all active:scale-95 rounded-full"
                      title="Швидкий перегляд"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => toggleCompare(product)}
                      className={cn(
                        "w-12 h-12 flex items-center justify-center transition-all active:scale-95 rounded-full",
                        compareList.some(p => p.id === product.id) ? "bg-accent text-white" : "bg-white text-black hover:bg-accent hover:text-white"
                      )}
                      title="Порівняти"
                    >
                      <ArrowLeftRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Content Area */}
                <div className="p-5 flex flex-col flex-1 bg-white relative z-10">
                  <div className="flex justify-between items-start gap-4 mb-4">
                    <h4 className="font-black uppercase text-sm leading-tight line-clamp-2">
                      {product.name}
                    </h4>
                    <div className="text-right shrink-0">
                      {product.oldPrice && (
                        <p className="text-[10px] font-mono font-bold text-slate-400 line-through uppercase tracking-widest">
                          ₴{product.oldPrice.toLocaleString()}
                        </p>
                      )}
                      <p className="text-lg font-mono font-black text-accent">
                        ₴{product.price.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Expandable Specs on Hover */}
                  <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-all duration-500 ease-in-out">
                    <div className="overflow-hidden">
                      <div className="pt-4 mt-2 border-t border-black/10 flex flex-col gap-2">
                        {product.specs && Object.entries(product.specs).slice(0, 3).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-[10px] font-mono">
                            <span className="text-slate-500">{key}</span>
                            <span className="font-bold text-black text-right">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => addToCart(product)}
                    className="w-full mt-auto pt-4 border-t-2 border-black flex items-center justify-between group/btn hover:text-accent transition-colors"
                  >
                    <span className="font-black uppercase text-xs tracking-widest">Додати в кошик</span>
                    <Plus className="w-5 h-5 group-hover/btn:rotate-90 transition-transform" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
          )}
        </section>
      </main>

      {/* Quick View Modal */}
      <AnimatePresence>
        {quickViewProduct && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setQuickViewProduct(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-4xl bg-white z-[110] border-4 border-black shadow-[20px_20px_0px_0px_#a8792a] flex flex-col md:flex-row max-h-[90vh] overflow-hidden"
            >
              <button 
                onClick={() => setQuickViewProduct(null)}
                className="absolute top-4 right-4 w-12 h-12 border-2 border-black flex items-center justify-center hover:bg-accent hover:text-black transition-all bg-white text-black z-10"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="w-full md:w-1/2 border-b-4 md:border-b-0 md:border-r-4 border-black bg-slate-50 p-8 flex items-center justify-center">
                <img src={quickViewProduct.image} alt={quickViewProduct.name} className="w-full h-auto object-contain grayscale hover:grayscale-0 transition-all duration-500" referrerPolicy="no-referrer" />
              </div>
              
              <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col overflow-y-auto">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-3 py-1 bg-black text-white text-[10px] font-black uppercase tracking-widest">
                    {quickViewProduct.category}
                  </span>
                  {quickViewProduct.badge && (
                    <span className="px-3 py-1 bg-accent text-black text-[10px] font-black uppercase tracking-widest border-2 border-black">
                      {quickViewProduct.badge}
                    </span>
                  )}
                </div>
                
                <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter mb-6 leading-none">
                  {quickViewProduct.name}
                </h2>
                
                <div className="flex items-center gap-2 mb-8">
                  <Star className="w-5 h-5 fill-black text-black" />
                  <span className="text-xl font-black">{quickViewProduct.rating}</span>
                </div>
                
                <p className="text-slate-500 font-bold mb-8 uppercase tracking-widest text-sm leading-relaxed">
                  Офіційна гарантія від виробника. Підтримка 24/7. Можливість розтермінування від ARM Bank без переплат.
                </p>
                
                <div className="mt-auto pt-8 border-t-4 border-black">
                  <div className="flex items-end gap-4 mb-8">
                    <span className="text-5xl font-black">₴{quickViewProduct.price.toLocaleString()}</span>
                    {quickViewProduct.oldPrice && (
                      <span className="text-xl font-black text-slate-400 line-through mb-1">₴{quickViewProduct.oldPrice.toLocaleString()}</span>
                    )}
                  </div>
                  
                  <button 
                    onClick={() => {
                      addToCart(quickViewProduct);
                      setQuickViewProduct(null);
                      setIsCartOpen(true);
                    }}
                    className="u24-button w-full text-lg py-6 flex items-center justify-center gap-4"
                  >
                    <ShoppingCart className="w-6 h-6" />
                    Додати в кошик
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Compare Modal */}
      <AnimatePresence>
        {isCompareModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCompareModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95%] max-w-6xl bg-white z-[110] border-4 border-black shadow-[20px_20px_0px_0px_#a8792a] flex flex-col max-h-[90vh] overflow-hidden"
            >
              <div className="p-6 md:p-8 border-b-4 border-black flex items-center justify-between bg-accent text-black shrink-0">
                <div className="flex items-center gap-4">
                  <ArrowLeftRight className="w-8 h-8" />
                  <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">Порівняння</h2>
                </div>
                <button 
                  onClick={() => setIsCompareModalOpen(false)}
                  className="w-12 h-12 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-all bg-white text-black"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overflow-x-hidden p-0 bg-slate-50">
                {compareList.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-8 py-20 p-6">
                    <div className="w-32 h-32 border-2 border-black flex items-center justify-center bg-white">
                      <ArrowLeftRight className="w-16 h-16 text-slate-300" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black uppercase">Список порожній</h3>
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Додайте товари для порівняння</p>
                    </div>
                    <button 
                      onClick={() => setIsCompareModalOpen(false)}
                      className="u24-button"
                    >
                      До каталогу
                    </button>
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto p-6 md:p-8">
                    <div className="min-w-[800px]">
                      {/* Products Header Row */}
                    <div className="grid grid-cols-[200px_1fr] gap-4 mb-8">
                      <div className="font-black uppercase tracking-widest text-slate-400 flex items-end pb-4">
                        Товари
                      </div>
                      <div className="grid grid-cols-4 gap-4">
                        {compareList.map(product => (
                          <div key={product.id} className="border-2 border-black bg-white p-4 relative group">
                            <button 
                              onClick={() => toggleCompare(product)}
                              className="absolute top-2 right-2 w-8 h-8 bg-white border-2 border-black flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors z-10"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <div className="aspect-square mb-4 border-2 border-black overflow-hidden bg-slate-50">
                              <img src={product.image} alt={product.name} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" referrerPolicy="no-referrer" />
                            </div>
                            <h4 className="font-black uppercase text-sm mb-2 line-clamp-2 h-10">{product.name}</h4>
                            <p className="text-xl font-black mb-4">₴{product.price.toLocaleString()}</p>
                            <button 
                              onClick={() => addToCart(product)}
                              className="w-full py-3 bg-black text-white font-black uppercase text-xs tracking-widest hover:bg-accent hover:text-black transition-colors border-2 border-black"
                            >
                              В кошик
                            </button>
                          </div>
                        ))}
                        {/* Empty slots if less than 4 */}
                        {Array.from({ length: 4 - compareList.length }).map((_, i) => (
                          <div key={`empty-${i}`} className="border-2 border-dashed border-slate-300 bg-slate-100/50 flex items-center justify-center p-4">
                            <span className="text-slate-400 font-black uppercase text-xs tracking-widest text-center">Місце для товару</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Specs Rows */}
                    <div className="space-y-2">
                      {allCompareSpecKeys.map(specKey => (
                        <div key={specKey} className="grid grid-cols-[200px_1fr] gap-4 border-b-2 border-black pb-2">
                          <div className="font-black uppercase tracking-widest text-xs flex items-center">
                            {specKey}
                          </div>
                          <div className="grid grid-cols-4 gap-4">
                            {compareList.map(product => (
                              <div key={`${product.id}-${specKey}`} className="font-bold text-sm flex items-center">
                                {product.specs?.[specKey] || <span className="text-slate-300">—</span>}
                              </div>
                            ))}
                            {Array.from({ length: 4 - compareList.length }).map((_, i) => (
                              <div key={`empty-spec-${i}`} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cart Sidebar */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xl bg-white z-[110] border-l-2 border-black flex flex-col"
            >
              <div className="p-8 border-b-2 border-black flex items-center justify-between bg-black text-white">
                <h2 className="text-3xl font-black uppercase tracking-tighter">Ваш Кошик</h2>
                <button 
                  onClick={() => setIsCartOpen(false)}
                  className="w-12 h-12 border-2 border-white flex items-center justify-center hover:bg-white hover:text-black transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-8">
                    <div className="w-32 h-32 border-2 border-black flex items-center justify-center">
                      <ShoppingCart className="w-16 h-16 text-slate-200" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black uppercase">Кошик порожній</h3>
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Час щось додати</p>
                    </div>
                    <button 
                      onClick={() => setIsCartOpen(false)}
                      className="u24-button"
                    >
                      До покупок
                    </button>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {cart.map(item => (
                      <div key={item.id} className="flex gap-6 pb-8 border-b-2 border-slate-100">
                        <div className="w-32 h-32 border-2 border-black shrink-0 overflow-hidden">
                          <img src={item.image} alt={item.name} className="w-full h-full object-cover grayscale" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-1 space-y-4">
                          <div className="flex justify-between items-start">
                            <h4 className="text-lg font-black uppercase leading-tight">{item.name}</h4>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center border-2 border-black">
                              <button 
                                onClick={() => updateQuantity(item.id, -1)}
                                className="w-10 h-10 flex items-center justify-center hover:bg-black hover:text-white transition-all"
                              >
                                <Minus className="w-4 h-4" />
                              </button>
                              <span className="w-12 text-center font-black">{item.quantity}</span>
                              <button 
                                onClick={() => updateQuantity(item.id, 1)}
                                className="w-10 h-10 flex items-center justify-center hover:bg-black hover:text-white transition-all"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                            <p className="text-xl font-black">₴{(item.price * item.quantity).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="space-y-8 pt-4">
                      <h3 className="text-xl font-black uppercase tracking-widest border-b-2 border-black pb-4">Оформлення</h3>
                      <div className="grid gap-4">
                        <input 
                          type="text" 
                          placeholder="ПІБ отримувача"
                          className="w-full p-4 border-2 border-black text-sm font-bold uppercase tracking-widest outline-none focus:bg-slate-50"
                        />
                        <textarea 
                          placeholder="Адреса доставки"
                          rows={2}
                          className="w-full p-4 border-2 border-black text-sm font-bold uppercase tracking-widest outline-none focus:bg-slate-50 resize-none"
                        />
                        <div className="relative">
                          <select className="w-full p-4 border-2 border-black text-sm font-bold uppercase tracking-widest outline-none appearance-none bg-white">
                            <option>Оплатити через ARM Bank</option>
                            <option>Карткою іншого банку</option>
                            <option>При отриманні</option>
                          </select>
                          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className="p-8 border-t-2 border-black space-y-6 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Разом до оплати</span>
                    <span className="text-4xl font-black">₴{cartTotal.toLocaleString()}</span>
                  </div>
                  <button 
                    onClick={handleCheckout}
                    disabled={isCheckingOut}
                    className="u24-button w-full py-6 text-lg flex items-center justify-center gap-4 group disabled:opacity-70"
                  >
                    {isCheckingOut ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                        ОБРОБКА...
                      </span>
                    ) : (
                      <>
                        Оформити замовлення
                        <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-black text-white pt-24 px-4 sm:px-8 overflow-hidden">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 mb-20">
            <div className="space-y-12">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 bg-accent text-black flex items-center justify-center font-black text-4xl border-2 border-accent">
                  ARM
                </div>
                <h2 className="text-5xl font-black uppercase tracking-tighter">Market</h2>
              </div>
              <p className="text-2xl text-slate-400 font-medium leading-tight max-w-xl">
                Ми створюємо майбутнє банківського рітейлу. Кожна покупка — це крок до технологічної незалежності.
              </p>
              <div className="flex gap-4">
                <button className="u24-button bg-accent text-black border-accent hover:bg-white hover:text-black hover:border-white">Підтримати проект</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-12">
              <div className="space-y-8">
                <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Каталог</h4>
                <ul className="space-y-4 text-sm font-bold uppercase tracking-widest">
                  {CATEGORIES.slice(1).map(cat => (
                    <li key={cat}><button onClick={() => setActiveCategory(cat)} className="hover:text-accent transition-colors">{cat}</button></li>
                  ))}
                </ul>
              </div>
              <div className="space-y-8">
                <h4 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Контакти</h4>
                <ul className="space-y-4 text-sm font-bold uppercase tracking-widest">
                  <li>0 800 500 500</li>
                  <li>support@arm.ua</li>
                  <li>Київ, Банкова 1</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="pt-12 border-t-2 border-white/10 flex flex-col md:flex-row justify-between items-center gap-8 text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 relative z-10 pb-8">
            <p>© 2024 ARM MARKET. ALL RIGHTS RESERVED.</p>
            <div className="flex gap-12">
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Cookies</a>
            </div>
          </div>
        </div>
        
        {/* Massive Footer Text */}
        <div className="w-full overflow-hidden border-t-2 border-white/10 pt-8 pb-4 bg-black text-white/5 relative flex justify-center">
          <h1 className="text-[15vw] leading-[0.8] font-black tracking-tighter select-none text-center">
            ARM MARKET
          </h1>
        </div>
      </footer>

      {/* Auth Modal */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAuthModalOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border-2 border-black z-[70] shadow-[16px_16px_0px_0px_#a8792a] p-8"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-3xl font-black uppercase tracking-tighter">Авторизація</h3>
                  <p className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mt-2">SECURE.LOGIN.PROTOCOL</p>
                </div>
                <button 
                  onClick={() => setIsAuthModalOpen(false)}
                  className="w-10 h-10 border-2 border-black flex items-center justify-center hover:bg-accent hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-4">
                  <input 
                    type="email" 
                    placeholder="EMAIL"
                    required
                    className="w-full p-4 border-2 border-black text-sm font-bold uppercase tracking-widest outline-none focus:bg-white bg-transparent"
                  />
                  <input 
                    type="password" 
                    placeholder="ПАРОЛЬ"
                    required
                    className="w-full p-4 border-2 border-black text-sm font-bold uppercase tracking-widest outline-none focus:bg-white bg-transparent"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={isAuthenticating}
                  className="u24-button w-full py-6 text-lg disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {isAuthenticating ? (
                    <>
                      <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                      АВТОРИЗАЦІЯ...
                    </>
                  ) : (
                    "Увійти в систему"
                  )}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Profile Drawer */}
      <AnimatePresence>
        {isProfileOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProfileOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ opacity: 0, x: '100%' }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-surface border-l-2 border-black z-[70] shadow-[-16px_0px_0px_0px_#a8792a] flex flex-col"
            >
              <div className="p-8 border-b-2 border-black flex justify-between items-start bg-white">
                <div>
                  <h3 className="text-3xl font-black uppercase tracking-tighter">Кабінет</h3>
                  <div className="inline-flex items-center gap-2 mt-2 bg-black text-accent px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-widest">
                    <span className="w-2 h-2 bg-accent animate-pulse"></span>
                    ID.7734 // КЛІЄНТ
                  </div>
                </div>
                <button 
                  onClick={() => setIsProfileOpen(false)}
                  className="w-10 h-10 border-2 border-black flex items-center justify-center hover:bg-accent hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Останні замовлення</h4>
                  <div className="border-2 border-black p-4 bg-white space-y-2">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                      <span className="font-mono text-[10px] font-bold">ORD.9921</span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-accent">Виконано</span>
                    </div>
                    <p className="text-sm font-bold uppercase">ARM Phone Ultra</p>
                    <p className="font-mono text-sm font-black">₴41,999</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Налаштування</h4>
                  <button className="w-full p-4 border-2 border-black text-left font-bold uppercase tracking-widest text-sm hover:bg-black hover:text-white transition-colors">
                    Особисті дані
                  </button>
                  <button className="w-full p-4 border-2 border-black text-left font-bold uppercase tracking-widest text-sm hover:bg-black hover:text-white transition-colors">
                    Платіжні картки
                  </button>
                </div>
              </div>

              <div className="p-8 border-t-2 border-black bg-white">
                <button 
                  onClick={handleLogout}
                  className="u24-button-outline w-full py-4 text-sm hover:bg-red-600 hover:text-white hover:border-red-600 hover:shadow-[4px_4px_0px_0px_#7f1d1d]"
                >
                  Вийти з системи
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Toast Container */}
      <div className="fixed bottom-8 right-8 z-[200] flex flex-col gap-4 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={cn(
                "pointer-events-auto flex items-center gap-4 p-4 border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] min-w-[300px]",
                toast.type === 'success' ? "bg-accent text-black" : 
                toast.type === 'error' ? "bg-red-500 text-white" : 
                "bg-white text-black"
              )}
            >
              {toast.type === 'success' && <ShieldCheck className="w-6 h-6 shrink-0" />}
              {toast.type === 'error' && <X className="w-6 h-6 shrink-0" />}
              {toast.type === 'info' && <Zap className="w-6 h-6 shrink-0" />}
              <p className="font-bold text-sm uppercase tracking-widest">{toast.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
