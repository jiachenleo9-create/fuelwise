import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Polyline } from 'react-native-svg';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { emptyData, ExpenseRecord, FuelRecord, FuelwiseData, loadData, saveData } from '@/lib/storage';

const DARK_COLORS = {
  bg: '#0A0F15',
  surface: '#111820',
  surface2: '#161F29',
  surface3: '#1B2632',
  border: '#30404E',
  text: '#F5F8FA',
  muted: '#B4C0C9',
  muted2: '#83929E',
  lime: '#C9F36B',
  orange: '#FF9D6E',
  red: '#FF7580',
  ink: '#131A0D',
  accent: '#17251D',
  accentBorder: '#496333',
  recordIcon: '#25341E',
  recordExpense: '#342820',
  bottomNav: '#0D141C',
  modalOverlay: 'rgba(3,7,10,.75)',
  selectorActive: '#23341F',
};

const COLORS = DARK_COLORS;

const fuelTypes = ['92号汽油', '95号汽油', '98号汽油', '0号柴油', '其他'];
const expenseCategories = ['停车费', '过路费', '洗车费', '保养维修', '保险车船税', '其他'];

type ViewName = 'overview' | 'records';
type FormType = 'fuel' | 'expense' | 'settings' | null;
type EditingRecord = { kind: 'fuel' | 'expense'; id: string } | null;

const dateString = (date = new Date()) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const monthKey = (date: string) => date.slice(0, 7);
const money = (value: number) => `¥ ${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fixed = (value: number, digits = 1) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const newId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function calculateTotals(data: FuelwiseData) {
  const fuel = data.fuelRecords;
  if (!fuel.length) return { distance: 0, cost: 0, consumption: null as number | null, perKm: null as number | null };
  const mileages = fuel.map((item) => item.mileage);
  const distance = Math.max(0, Math.max(...mileages) - Math.min(...mileages));
  const cost = fuel.reduce((sum, item) => sum + item.amount, 0);
  const ordered = [...fuel].sort((a, b) => a.mileage - b.mileage);
  let intervalLiters = 0;
  let intervalDistance = 0;
  let previousFullIndex = -1;
  ordered.forEach((record, index) => {
    if (!record.fullTank) return;
    if (previousFullIndex >= 0) {
      const distanceBetweenFull = record.mileage - ordered[previousFullIndex].mileage;
      const litersBetweenFull = ordered.slice(previousFullIndex + 1, index + 1).reduce((sum, item) => sum + item.liters, 0);
      if (distanceBetweenFull > 0) {
        intervalDistance += distanceBetweenFull;
        intervalLiters += litersBetweenFull;
      }
    }
    previousFullIndex = index;
  });
  const consumption = intervalDistance > 0 ? (intervalLiters / intervalDistance) * 100 : fuel.length > 1 && distance > 0 ? (fuel.reduce((sum, item) => sum + item.liters, 0) / distance) * 100 : null;
  return { distance, cost, consumption, perKm: distance > 0 ? cost / distance : null };
}

function analyzeFuel(data: FuelwiseData) {
  const ordered = [...data.fuelRecords].sort((a, b) => a.mileage - b.mileage);
  const fullTankIndexes = ordered.map((item, index) => item.fullTank ? index : -1).filter((index) => index >= 0);
  const intervals = fullTankIndexes.slice(1).map((index, position) => {
    const previousIndex = fullTankIndexes[position];
    const distance = ordered[index].mileage - ordered[previousIndex].mileage;
    const intervalRecords = ordered.slice(previousIndex + 1, index + 1);
    const liters = intervalRecords.reduce((sum, item) => sum + item.liters, 0);
    const cost = intervalRecords.reduce((sum, item) => sum + item.amount, 0);
    return distance > 0 ? { distance, liters, cost, consumption: (liters / distance) * 100, perKm: cost / distance } : null;
  }).filter((item): item is { distance: number; liters: number; cost: number; consumption: number; perKm: number } => Boolean(item));
  const latest = intervals.at(-1);
  const average = intervals.length ? intervals.reduce((sum, item) => sum + item.consumption, 0) / intervals.length : calculateTotals(data).consumption;
  const intervalDistance = intervals.reduce((sum, item) => sum + item.distance, 0);
  const intervalCost = intervals.reduce((sum, item) => sum + item.cost, 0);
  const averagePerKm = intervalDistance > 0 ? intervalCost / intervalDistance : calculateTotals(data).perKm;
  const best = intervals.length ? Math.min(...intervals.map((item) => item.consumption)) : null;
  const worst = intervals.length ? Math.max(...intervals.map((item) => item.consumption)) : null;
  return { latest, average, averagePerKm, best, worst, sampleCount: intervals.length };
}

function monthTotals(data: FuelwiseData, key: string) {
  const fuel = data.fuelRecords.filter((item) => monthKey(item.date) === key);
  const other = data.expenseRecords.filter((item) => monthKey(item.date) === key);
  return {
    fuel: fuel.reduce((sum, item) => sum + item.amount, 0),
    other: other.reduce((sum, item) => sum + item.amount, 0),
    count: fuel.length + other.length,
  };
}

function rangeMonths(count: number) {
  const start = new Date(new Date().getFullYear(), new Date().getMonth() - count + 1, 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return { key: monthKey(dateString(date)), label: `${date.getMonth() + 1}月` };
  });
}

function buildTrend(data: FuelwiseData, count: number) {
  return rangeMonths(count).map(({ key, label }) => {
    const monthFuel = data.fuelRecords.filter((item) => monthKey(item.date) === key);
    const monthly = monthTotals(data, key);
    const monthlyAnalysis = analyzeFuel({ ...data, fuelRecords: monthFuel });
    return { label, cost: monthly.fuel + monthly.other, consumption: monthlyAnalysis.average };
  });
}

function formatDateTitle() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: '2-digit', day: '2-digit' }).toUpperCase().replace(',', ' ·');
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<FuelwiseData>(emptyData());
  const [view, setView] = useState<ViewName>('overview');
  const [formType, setFormType] = useState<FormType>(null);
  const [editingRecord, setEditingRecord] = useState<EditingRecord>(null);
  const [filter, setFilter] = useState<'all' | 'fuel' | 'expense'>('all');
  const [search, setSearch] = useState('');
  const [trendRange, setTrendRange] = useState<3 | 6 | 12>(6);

  useFocusEffect(useCallback(() => {
    let active = true;
    loadData().then((stored) => {
      if (active) setData(stored);
    });
    return () => { active = false; };
  }, []));

  const totals = useMemo(() => calculateTotals(data), [data]);
  const analysis = useMemo(() => analyzeFuel(data), [data]);
  const trend = useMemo(() => buildTrend(data, trendRange), [data, trendRange]);
  const thisMonth = useMemo(() => monthTotals(data, monthKey(dateString())), [data]);
  const recent = useMemo(() => [...data.fuelRecords.map((item) => ({ ...item, kind: 'fuel' as const })), ...data.expenseRecords.map((item) => ({ ...item, kind: 'expense' as const }))].sort((a, b) => `${b.date}-${b.createdAt}`.localeCompare(`${a.date}-${a.createdAt}`)), [data]);
  const filteredRecords = useMemo(() => recent.filter((item) => {
    const matchesType = filter === 'all' || item.kind === filter;
    const haystack = `${'category' in item ? item.category : item.fuelType}${'note' in item ? item.note : ''}`.toLowerCase();
    return matchesType && haystack.includes(search.trim().toLowerCase());
  }), [filter, recent, search]);

  const persist = async (next: FuelwiseData) => { setData(next); await saveData(next); };

  const updateSettings = async (settings: FuelwiseData['settings']) => {
    const next = { ...data, settings };
    await persist(next);
    setFormType(null);
  };

  const openCreate = (type: Exclude<FormType, null | 'settings'>) => {
    setEditingRecord(null);
    setFormType(type);
  };

  const openEdit = (kind: 'fuel' | 'expense', id: string) => {
    setEditingRecord({ kind, id });
    setFormType(kind);
  };

  const closeForm = () => {
    setEditingRecord(null);
    setFormType(null);
  };

  const deleteRecord = (kind: 'fuel' | 'expense', id: string) => {
    Alert.alert('删除记录', '确定要删除这条记录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => persist({ ...data, fuelRecords: kind === 'fuel' ? data.fuelRecords.filter((item) => item.id !== id) : data.fuelRecords, expenseRecords: kind === 'expense' ? data.expenseRecords.filter((item) => item.id !== id) : data.expenseRecords }) },
    ]);
  };

  const saveFuel = async (values: FuelFormValues) => {
    const amount = Number(values.amount || 0);
    const price = Number(values.price || 0);
    const liters = Number(values.liters || (price ? amount / price : 0));
    if (!values.date || !values.mileage || !amount || !price || !liters) return Alert.alert('还差一点', '请填写里程、油价、金额或升数。');
    const record: FuelRecord = { id: editingRecord?.kind === 'fuel' ? editingRecord.id : newId(), createdAt: editingRecord?.kind === 'fuel' ? (data.fuelRecords.find((item) => item.id === editingRecord.id)?.createdAt || Date.now()) : Date.now(), date: values.date, fuelType: values.fuelType, price, amount, liters, mileage: Number(values.mileage), fullTank: values.fullTank };
    const fuelRecords = editingRecord?.kind === 'fuel' ? data.fuelRecords.map((item) => item.id === editingRecord.id ? record : item) : [...data.fuelRecords, record];
    await persist({ ...data, fuelRecords });
    closeForm();
  };

  const saveExpense = async (values: ExpenseFormValues) => {
    if (!values.date || !values.amount) return Alert.alert('还差一点', '请填写日期和金额。');
    const record: ExpenseRecord = { id: editingRecord?.kind === 'expense' ? editingRecord.id : newId(), createdAt: editingRecord?.kind === 'expense' ? (data.expenseRecords.find((item) => item.id === editingRecord.id)?.createdAt || Date.now()) : Date.now(), date: values.date, amount: Number(values.amount), category: values.category, note: values.note };
    const expenseRecords = editingRecord?.kind === 'expense' ? data.expenseRecords.map((item) => item.id === editingRecord.id ? record : item) : [...data.expenseRecords, record];
    await persist({ ...data, expenseRecords });
    closeForm();
  };

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}> 
      <StatusBar style="light" />
      <View style={styles.app}>
        <View style={styles.header}>
          <View style={styles.brandRow}><View style={styles.brandMark}><View style={styles.brandBar1} /><View style={styles.brandBar2} /><View style={styles.brandBar3} /></View><View><Text style={styles.brand}>fuelwise</Text><Text style={styles.brandSub}>用车成本管家</Text></View></View>
          <Pressable style={styles.avatar} onPress={() => setFormType('settings')}><Text style={styles.avatarText}>{data.settings.ownerName === '车主' ? 'ME' : data.settings.ownerName.slice(0, 2)}</Text></Pressable>
        </View>

        {view === 'overview' ? (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.titleRow}><View><Text style={styles.eyebrow}>{formatDateTitle()}</Text><Text style={styles.title}>你好，{data.settings.ownerName} <Text style={styles.lime}>✦</Text></Text><Text style={styles.subtitle}>这是你的用车成本驾驶舱。</Text></View><Pressable style={styles.addButton} onPress={() => openCreate('fuel')}><Ionicons name="add" size={18} color="#131A0D" /><Text style={styles.addButtonText}>记加油</Text></Pressable></View>
            <View style={styles.metricGrid}>
              <MetricCard label="累计行驶里程" value={fixed(totals.distance, 0)} unit="km" />
              <MetricCard label="累计油费" value={money(totals.cost)} unit="全部油费" />
            </View>
            <View style={styles.sectionHeader}><View><Text style={styles.sectionKicker}>FUEL ANALYSIS</Text><Text style={styles.sectionTitle}>油耗分析</Text></View><Ionicons name="pulse-outline" size={19} color={COLORS.lime} /></View>
            <View style={extraStyles.analysisGrid}><AnalysisGroup title="本次区间" icon="speedometer-outline"><AnalysisMetric label="区间油耗" value={analysis.latest ? `${fixed(analysis.latest.consumption)} L/100km` : '等待下一次加满'} note={analysis.latest ? `${fixed(analysis.latest.distance, 0)} km · ${fixed(analysis.latest.liters, 2)} L` : '连续记录两次加满后自动分析'} /><AnalysisMetric label="每公里成本" value={analysis.latest ? `${fixed(analysis.latest.perKm, 2)} 元/km` : '—'} note={analysis.latest ? `区间油费 ${money(analysis.latest.cost)}` : '完成一个加满区间后显示'} /></AnalysisGroup><AnalysisGroup title="历史油耗" icon="analytics-outline"><AnalysisMetric label="历史平均油耗" value={analysis.average == null ? '—' : `${fixed(analysis.average)} L/100km`} note={analysis.sampleCount ? `${analysis.sampleCount} 个加满区间 · 最佳 ${fixed(analysis.best ?? 0)} · 最高 ${fixed(analysis.worst ?? 0)} L/100km` : '还没有足够的历史区间'} /><AnalysisMetric label="平均每公里成本" value={analysis.averagePerKm == null ? '—' : `${fixed(analysis.averagePerKm, 2)} 元/km`} note={analysis.sampleCount ? '按加满区间加权计算' : '完成一个加满区间后显示'} /></AnalysisGroup></View>
            {analysis.best != null && analysis.worst != null && <View style={extraStyles.insightCard}><Ionicons name="sparkles-outline" size={18} color={COLORS.lime} /><Text style={extraStyles.insightText}>历史最佳 {fixed(analysis.best)}，最高 {fixed(analysis.worst)} L/100km。保持相近的驾驶路况，数据会更有参考价值。</Text></View>}
            <TrendPanel data={trend} range={trendRange} onRangeChange={setTrendRange} />
            <View style={styles.sectionHeader}><Text style={styles.sectionKicker}>THIS MONTH</Text><Text style={styles.sectionTitle}>本月总览</Text></View>
            <View style={styles.monthCard}><View style={styles.monthTop}><Text style={styles.monthTotal}>{money(thisMonth.fuel + thisMonth.other)}</Text><Text style={styles.monthBadge}>{new Date().getMonth() + 1} 月</Text></View><View style={styles.breakdown}><BreakdownRow label="油费" value={money(thisMonth.fuel)} color={COLORS.lime} /><BreakdownRow label="其他开销" value={money(thisMonth.other)} color={COLORS.orange} /></View><View style={styles.progressTrack}><View style={[styles.progress, { width: `${Math.min(100, (thisMonth.fuel + thisMonth.other) / 3000 * 100)}%` }]} /></View><Text style={styles.note}>{thisMonth.count ? `${thisMonth.count} 笔记录，继续保持。` : '记录你的第一笔开销，开始掌握成本。'}</Text><Pressable style={styles.linkButton} onPress={() => openCreate('expense')}><Text style={styles.linkText}>＋ 记录其他开销</Text></Pressable></View>
            <View style={styles.sectionHeader}><Text style={styles.sectionKicker}>LATEST ACTIVITY</Text><Pressable onPress={() => setView('records')}><Text style={styles.linkText}>查看全部 →</Text></Pressable></View>
            {recent.length ? recent.slice(0, 4).map((item) => <RecordRow key={`${item.kind}-${item.id}`} item={item} onEdit={openEdit} onDelete={deleteRecord} />) : <EmptyState onAdd={() => openCreate('fuel')} />}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.titleRow}><View><Text style={styles.eyebrow}>ACTIVITY LOG</Text><Text style={styles.title}>历史记录</Text><Text style={styles.subtitle}>所有加油和用车开销都在这里。</Text></View><Pressable style={styles.addButton} onPress={() => openCreate('fuel')}><Ionicons name="add" size={18} color="#131A0D" /><Text style={styles.addButtonText}>记加油</Text></Pressable></View>
            <View style={styles.filterRow}>{(['all', 'fuel', 'expense'] as const).map((item) => <Pressable key={item} style={[styles.filterButton, filter === item && styles.filterActive]} onPress={() => setFilter(item)}><Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item === 'all' ? `全部 ${recent.length}` : item === 'fuel' ? `加油 ${data.fuelRecords.length}` : `其他 ${data.expenseRecords.length}`}</Text></Pressable>)}</View>
            <View style={styles.searchBox}><Ionicons name="search-outline" size={17} color={COLORS.muted2} /><TextInput value={search} onChangeText={setSearch} placeholder="搜索记录..." placeholderTextColor={COLORS.muted2} style={styles.searchInput} /></View>
            {filteredRecords.length ? filteredRecords.map((item) => <RecordRow key={`${item.kind}-${item.id}`} item={item} onEdit={openEdit} onDelete={deleteRecord} />) : <EmptyState onAdd={() => openCreate('fuel')} />}
          </ScrollView>
        )}

        <View style={[styles.bottomNav, { backgroundColor: COLORS.bottomNav, paddingBottom: insets.bottom + 7 }]}><NavButton icon="grid-outline" label="总览" active={view === 'overview'} onPress={() => setView('overview')} /><NavButton icon="receipt-outline" label="历史" active={view === 'records'} onPress={() => setView('records')} /><Pressable style={styles.fab} onPress={() => openCreate('fuel')}><Ionicons name="add" size={26} color="#131A0D" /></Pressable><NavButton icon="wallet-outline" label="开销" active={false} onPress={() => openCreate('expense')} /><NavButton icon="settings-outline" label="设置" active={false} onPress={() => setFormType('settings')} /></View>
      </View>
      <FuelModal visible={formType === 'fuel'} onClose={closeForm} onSave={saveFuel} lastPrice={data.fuelRecords.at(-1)?.price} record={editingRecord?.kind === 'fuel' ? data.fuelRecords.find((item) => item.id === editingRecord.id) : undefined} />
      <ExpenseModal visible={formType === 'expense'} onClose={closeForm} onSave={saveExpense} record={editingRecord?.kind === 'expense' ? data.expenseRecords.find((item) => item.id === editingRecord.id) : undefined} />
      <SettingsModal visible={formType === 'settings'} onClose={() => setFormType(null)} settings={data.settings} onSave={updateSettings} />
    </View>
  );
}

function MetricCard({ label, value, unit, accent = false }: { label: string; value: string; unit: string; accent?: boolean }) {
  return <View style={[styles.metricCard, accent && styles.metricCardAccent, { backgroundColor: accent ? COLORS.accent : COLORS.surface, borderColor: accent ? COLORS.accentBorder : COLORS.border }]}><View style={styles.metricLabelRow}><Text style={styles.metricLabel}>{label}</Text><Ionicons name={accent ? 'speedometer-outline' : 'analytics-outline'} size={17} color={COLORS.lime} /></View><Text style={styles.metricValue}>{value}<Text style={styles.metricUnit}> {unit}</Text></Text><Text style={styles.metricFoot}>{label === '平均油耗' ? '基于加满区间计算' : '全部历史记录'}</Text></View>;
}

function AnalysisGroup({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return <View style={extraStyles.analysisGroup}><View style={extraStyles.analysisGroupHeader}><Text style={extraStyles.analysisGroupTitle}>{title}</Text><Ionicons name={icon} size={17} color={COLORS.lime} /></View>{children}</View>;
}

function AnalysisMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return <View style={extraStyles.analysisMetric}><View><Text style={extraStyles.analysisTitle}>{label}</Text><Text style={extraStyles.analysisValue}>{value}</Text></View><Text style={extraStyles.analysisNote}>{note}</Text></View>;
}

function TrendPanel({ data, range, onRangeChange }: { data: { label: string; cost: number; consumption: number | null }[]; range: 3 | 6 | 12; onRangeChange: (range: 3 | 6 | 12) => void }) {
  return <View style={extraStyles.trendPanel}><View style={extraStyles.trendHeader}><View><Text style={styles.sectionKicker}>TREND ANALYSIS</Text><Text style={styles.sectionTitle}>油耗及成本变化</Text></View><View style={extraStyles.rangeSwitch}>{([3, 6, 12] as const).map((item) => <Pressable key={item} style={[extraStyles.rangeButton, range === item && extraStyles.rangeButtonActive]} onPress={() => onRangeChange(item)}><Text style={[extraStyles.rangeText, range === item && extraStyles.rangeTextActive]}>{item === 3 ? '近3月' : item === 6 ? '近6月' : '近1年'}</Text></Pressable>)}</View></View><TrendLine title="月度成本" values={data.map((item) => item.cost)} color={COLORS.orange} unit="元" /><TrendLine title="平均油耗" values={data.map((item) => item.consumption)} color={COLORS.lime} unit="L/100km" /></View>;
}

function TrendLine({ title, values, color, unit }: { title: string; values: (number | null)[]; color: string; unit: string }) {
  const [chartWidth, setChartWidth] = useState(0);
  const plotHeight = 82;
  const plotWidth = Math.max(chartWidth, 1);
  const valid = values.filter((value): value is number => value != null);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const span = max - min || 1;
  const pointX = (index: number) => values.length === 1 ? plotWidth / 2 : index / (values.length - 1) * plotWidth;
  const pointY = (value: number) => 10 + (1 - (value - min) / span) * (plotHeight - 20);
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (currentGroup.length) groups.push(currentGroup);
      currentGroup = [];
    } else {
      currentGroup.push(index);
    }
  });
  if (currentGroup.length) groups.push(currentGroup);
  const last = valid.at(-1);

  const handleLayout = (event: { nativeEvent: { layout: { width: number } } }) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== chartWidth) setChartWidth(nextWidth);
  };

  return <View style={extraStyles.trendRow}>
    <View style={extraStyles.trendMeta}>
      <Text style={extraStyles.trendTitle}>{title}</Text>
      <Text style={[extraStyles.trendValue, { color }]}>{last == null ? "暂无数据" : fixed(last, unit === "元" ? 0 : 1) + " " + unit}</Text>
    </View>
    {valid.length > 0 ? <View style={extraStyles.lineChart} onLayout={handleLayout}>
      {chartWidth > 0 ? <Svg width={chartWidth} height={plotHeight} viewBox={`0 0 ${chartWidth} ${plotHeight}`} preserveAspectRatio="none">
        <>{groups.map((indices, groupIndex) => <Polyline key={"group-" + groupIndex} points={indices.map((index) => String(pointX(index)) + "," + String(pointY(values[index] as number))).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
          {values.map((value, index) => value == null ? null : <Circle key={String(index) + "-" + String(value)} cx={pointX(index)} cy={pointY(value)} r="4" fill={COLORS.surface} stroke={color} strokeWidth="2" />)}
        </>
      </Svg> : null}
      <View style={extraStyles.chartLabels}>{dataLabels(values.length).map((label) => <Text key={label.key} style={extraStyles.chartLabel}>{label.text}</Text>)}</View>
    </View> : <View style={extraStyles.noTrend}><Text style={extraStyles.noTrendText}>记录两次加满后显示趋势</Text></View>}
  </View>;
}
function dataLabels(count: number) { return rangeMonths(count).map((item) => ({ key: item.key, text: item.label })); }

function BreakdownRow({ label, value, color }: { label: string; value: string; color: string }) { return <View style={styles.breakdownRow}><View style={styles.labelRow}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.breakdownLabel}>{label}</Text></View><Text style={styles.breakdownValue}>{value}</Text></View>; }

function NavButton({ icon, label, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; onPress: () => void }) { return <Pressable style={styles.navButton} onPress={onPress}><Ionicons name={icon} size={20} color={active ? COLORS.lime : COLORS.muted} /><Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text></Pressable>; }

function EmptyState({ onAdd }: { onAdd: () => void }) { return <View style={styles.empty}><Ionicons name="document-text-outline" size={27} color={COLORS.muted2} /><Text style={styles.emptyTitle}>还没有用车记录</Text><Text style={styles.emptyText}>记录第一笔加油，开始建立你的成本档案。</Text><Pressable onPress={onAdd}><Text style={styles.linkText}>＋ 现在记录</Text></Pressable></View>; }

function RecordRow({ item, onEdit, onDelete }: { item: (FuelRecord & { kind: 'fuel' }) | (ExpenseRecord & { kind: 'expense' }); onEdit: (kind: 'fuel' | 'expense', id: string) => void; onDelete: (kind: 'fuel' | 'expense', id: string) => void }) {
  const isFuel = item.kind === 'fuel';
  return <View style={styles.recordRow}><View style={[styles.recordIcon, !isFuel && styles.recordIconExpense, { backgroundColor: isFuel ? COLORS.recordIcon : COLORS.recordExpense }]}><Ionicons name={isFuel ? 'flame-outline' : 'wallet-outline'} size={19} color={isFuel ? COLORS.lime : COLORS.orange} /></View><View style={styles.recordContent}><Text style={styles.recordTitle} numberOfLines={1}>{isFuel ? `${item.fuelType} · ${fixed(item.liters, 2)} L` : item.note || item.category}</Text><Text style={styles.recordMeta}>{isFuel ? `${fixed(item.mileage, 0)} km · ${item.fullTank ? '已加满' : '未加满'}` : item.category}</Text></View><View style={styles.recordRight}><Text style={[styles.recordAmount, !isFuel && styles.recordAmountExpense]}>{isFuel ? '-' : '+'}{money(item.amount)}</Text><Text style={styles.recordDate}>{dayLabel(item.date)}</Text></View><View style={extraStyles.recordActions}><Pressable onPress={() => onEdit(item.kind, item.id)} hitSlop={10}><Ionicons name="create-outline" size={18} color={COLORS.muted} /></Pressable><Pressable onPress={() => onDelete(item.kind, item.id)} hitSlop={10}><Ionicons name="close-circle-outline" size={18} color={COLORS.muted2} /></Pressable></View></View>;
}

type FuelFormValues = { date: string; fuelType: string; price: string; amount: string; liters: string; mileage: string; fullTank: boolean };
type ExpenseFormValues = { date: string; amount: string; category: string; note: string };

function DateField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedDate = new Date(`${value || dateString()}T00:00:00`);
  const displayValue = selectedDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const [visibleMonth, setVisibleMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const openCalendar = () => { setVisibleMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)); setOpen(true); };
  const chooseDate = (day: number) => { onChangeText(dateString(new Date(year, month, day))); setOpen(false); };
  const shiftMonth = (offset: number) => setVisibleMonth(new Date(year, month + offset, 1));
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><Pressable style={styles.inputWrap} onPress={openCalendar}><Text style={styles.input}>{displayValue}</Text><Ionicons name="calendar-outline" size={17} color={COLORS.lime} style={styles.inputSuffix} /></Pressable><Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={styles.dateModalBackdrop}><View style={styles.dateModalCard}><View style={styles.dateModalHeader}><View><Text style={styles.dateModalKicker}>DATE SELECTOR</Text><Text style={styles.dateModalTitle}>选择日期</Text></View><Pressable style={styles.closeButton} onPress={() => setOpen(false)}><Ionicons name="close" size={20} color={COLORS.muted} /></Pressable></View><View style={styles.dateMonthHeader}><Pressable style={styles.dateNavButton} onPress={() => shiftMonth(-1)}><Ionicons name="chevron-back" size={18} color={COLORS.text} /></Pressable><Text style={styles.dateMonthTitle}>{year}年 {month + 1}月</Text><Pressable style={styles.dateNavButton} onPress={() => shiftMonth(1)}><Ionicons name="chevron-forward" size={18} color={COLORS.text} /></Pressable></View><View style={styles.dateWeekRow}>{['一', '二', '三', '四', '五', '六', '日'].map((weekday) => <Text key={weekday} style={styles.dateWeekday}>{weekday}</Text>)}</View><View style={styles.dateGrid}>{calendarCells.map((day, index) => day == null ? <View key={`empty-${index}`} style={styles.dateDay} /> : <Pressable key={day} style={[styles.dateDay, dateString(new Date(year, month, day)) === value && styles.dateDaySelected, dateString(new Date(year, month, day)) === dateString() && styles.dateDayToday]} onPress={() => chooseDate(day)}><Text style={[styles.dateDayText, dateString(new Date(year, month, day)) === dateString() && styles.dateDayTodayText, dateString(new Date(year, month, day)) === value && styles.dateDaySelectedText]}>{day}</Text></Pressable>)}</View><View style={styles.dateModalFooter}><Text style={styles.dateSelectedText}>已选：{displayValue}</Text><Pressable onPress={() => setOpen(false)}><Text style={styles.dateCancelText}>取消</Text></Pressable></View></View></View></Modal></View>;
}

function Field({ label, value, onChangeText, placeholder, suffix, keyboardType = 'default' }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; suffix?: string; keyboardType?: 'default' | 'decimal-pad' }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><View style={styles.inputWrap}><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.muted2} keyboardType={keyboardType} style={styles.input} /><Text style={styles.inputSuffix}>{suffix}</Text></View></View>; }

function Selector({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) { return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorRow}>{options.map((option) => <Pressable key={option} style={[styles.selector, option === value && styles.selectorActive, option === value && { backgroundColor: COLORS.selectorActive }]} onPress={() => onChange(option)}><Text style={[styles.selectorText, option === value && styles.selectorTextActive]}>{option}</Text></Pressable>)}</ScrollView>; }

function FuelModal({ visible, onClose, onSave, lastPrice, record }: { visible: boolean; onClose: () => void; onSave: (values: FuelFormValues) => void; lastPrice?: number; record?: FuelRecord }) {
  const [values, setValues] = useState<FuelFormValues>({ date: dateString(), fuelType: '92号汽油', price: String(lastPrice || 7.89), amount: '', liters: '', mileage: '', fullTank: true });
  React.useEffect(() => { if (visible) setValues(record ? { date: record.date, fuelType: record.fuelType, price: String(record.price), amount: String(record.amount), liters: String(record.liters), mileage: String(record.mileage), fullTank: record.fullTank } : { date: dateString(), fuelType: '92号汽油', price: String(lastPrice || 7.89), amount: '', liters: '', mileage: '', fullTank: true }); }, [visible, lastPrice, record]);
  const patch = (next: Partial<FuelFormValues>) => setValues((current) => ({ ...current, ...next }));
  const setAmount = (amount: string) => patch({ amount, liters: amount && Number(values.price) ? (Number(amount) / Number(values.price)).toFixed(2) : values.liters });
  const setLiters = (liters: string) => patch({ liters, amount: liters && Number(values.price) ? (Number(liters) * Number(values.price)).toFixed(2) : values.amount });
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalBackdrop, { backgroundColor: COLORS.modalOverlay }]}><View style={styles.modalCard}><ModalHeader kicker="FUEL LOG" title={record ? "编辑加油记录" : "记一笔加油"} onClose={onClose} /><ScrollView showsVerticalScrollIndicator={false}><DateField label="加油日期" value={values.date} onChangeText={(date) => patch({ date })} /><Field label="当前表显里程" value={values.mileage} onChangeText={(mileage) => patch({ mileage })} placeholder="例如 52880" suffix="km" keyboardType="decimal-pad" /><Text style={styles.fieldLabel}>油品标号</Text><Selector value={values.fuelType} options={fuelTypes} onChange={(fuelType) => patch({ fuelType })} /><View style={styles.formColumns}><View style={styles.column}><Field label="单价" value={values.price} onChangeText={(price) => patch({ price })} suffix="元/L" keyboardType="decimal-pad" /></View><View style={styles.column}><Field label="加油金额" value={values.amount} onChangeText={setAmount} suffix="元" keyboardType="decimal-pad" /></View></View><Field label="加油升数" value={values.liters} onChangeText={setLiters} suffix="L" keyboardType="decimal-pad" /><View style={styles.switchRow}><View><Text style={styles.switchTitle}>本次是否加满</Text><Text style={styles.switchHint}>用于计算两次加满之间的真实油耗</Text></View><Switch value={values.fullTank} onValueChange={(fullTank) => patch({ fullTank })} trackColor={{ false: COLORS.surface3, true: COLORS.accentBorder }} thumbColor={values.fullTank ? COLORS.lime : COLORS.muted} /></View><Pressable style={styles.modalSave} onPress={() => onSave(values)}><Text style={styles.modalSaveText}>{record ? "保存修改" : "保存记录"}</Text></Pressable></ScrollView></View></KeyboardAvoidingView></Modal>;
}

function ExpenseModal({ visible, onClose, onSave, record }: { visible: boolean; onClose: () => void; onSave: (values: ExpenseFormValues) => void; record?: ExpenseRecord }) {
  const [values, setValues] = useState<ExpenseFormValues>({ date: dateString(), amount: '', category: expenseCategories[0], note: '' });
  React.useEffect(() => { if (visible) setValues(record ? { date: record.date, amount: String(record.amount), category: record.category, note: record.note } : { date: dateString(), amount: '', category: expenseCategories[0], note: '' }); }, [visible, record]);
  const patch = (next: Partial<ExpenseFormValues>) => setValues((current) => ({ ...current, ...next }));
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalBackdrop, { backgroundColor: COLORS.modalOverlay }]}><View style={styles.modalCard}><ModalHeader kicker="OTHER COST" title={record ? "编辑其他开销" : "记录其他开销"} onClose={onClose} /><ScrollView showsVerticalScrollIndicator={false}><DateField label="发生日期" value={values.date} onChangeText={(date) => patch({ date })} /><Field label="金额" value={values.amount} onChangeText={(amount) => patch({ amount })} suffix="元" keyboardType="decimal-pad" /><Text style={styles.fieldLabel}>开销类别</Text><Selector value={values.category} options={expenseCategories} onChange={(category) => patch({ category })} /><Field label="备注（选填）" value={values.note} onChangeText={(note) => patch({ note })} placeholder="例如：更换机油和滤芯" /><Pressable style={styles.modalSave} onPress={() => onSave(values)}><Text style={styles.modalSaveText}>{record ? "保存修改" : "保存开销"}</Text></Pressable></ScrollView></View></KeyboardAvoidingView></Modal>;
}

function SettingsModal({ visible, onClose, settings, onSave }: { visible: boolean; onClose: () => void; settings: FuelwiseData['settings']; onSave: (settings: FuelwiseData['settings']) => void }) {
  const [ownerName, setOwnerName] = useState(settings.ownerName);
  React.useEffect(() => { if (visible) setOwnerName(settings.ownerName); }, [settings.ownerName, visible]);
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalBackdrop, { backgroundColor: COLORS.modalOverlay }]}><View style={styles.modalCard}><ModalHeader kicker="PREFERENCES" title="设置" onClose={onClose} /><ScrollView showsVerticalScrollIndicator={false}><Field label="车主姓名" value={ownerName} onChangeText={setOwnerName} placeholder="例如：小林" /><View style={extraStyles.settingsTip}><Ionicons name="moon-outline" size={17} color={COLORS.lime} /><Text style={extraStyles.settingsTipText}>当前使用深色主题。你的记录只保存在当前手机本地，不会上传服务器。</Text></View><Pressable style={styles.modalSave} onPress={() => onSave({ ownerName: ownerName.trim() || '车主' })}><Text style={styles.modalSaveText}>保存设置</Text></Pressable></ScrollView></View></KeyboardAvoidingView></Modal>;
}
function ModalHeader({ kicker, title, onClose }: { kicker: string; title: string; onClose: () => void }) { return <View style={styles.modalHeader}><View><Text style={styles.eyebrow}>{kicker}</Text><Text style={styles.modalTitle}>{title}</Text></View><Pressable style={styles.closeButton} onPress={onClose}><Ionicons name="close" size={21} color={COLORS.muted} /></Pressable></View>; }

function makeStyles() {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg }, app: { flex: 1, backgroundColor: COLORS.bg }, header: { height: 72, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brandMark: { width: 28, height: 28, borderWidth: 1, borderColor: COLORS.lime, borderRadius: 8, transform: [{ rotate: '-8deg' }], flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3, paddingBottom: 5 }, brandBar1: { width: 4, height: 8, backgroundColor: COLORS.lime, borderRadius: 2 }, brandBar2: { width: 4, height: 13, backgroundColor: COLORS.lime, borderRadius: 2 }, brandBar3: { width: 4, height: 17, backgroundColor: COLORS.lime, borderRadius: 2 }, brand: { color: COLORS.text, fontWeight: '800', fontSize: 18, letterSpacing: -0.8 }, brandSub: { color: COLORS.muted, fontSize: 9, marginTop: 1 }, avatar: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.lime }, avatarText: { color: COLORS.ink, fontSize: 10, fontWeight: '800' }, scrollContent: { paddingHorizontal: 20, paddingBottom: 110 }, titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 13, marginBottom: 26 }, eyebrow: { color: COLORS.lime, fontSize: 9, letterSpacing: 1.4, fontWeight: '700', marginBottom: 8 }, title: { color: COLORS.text, fontSize: 29, fontWeight: '800', letterSpacing: -1.3 }, lime: { color: COLORS.lime }, subtitle: { color: COLORS.muted, fontSize: 12, marginTop: 8 }, addButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.lime, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }, addButtonText: { color: COLORS.ink, fontSize: 11, fontWeight: '800', marginLeft: 2 }, metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, metricCard: { width: '48.4%', minHeight: 132, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 15 }, metricCardAccent: { backgroundColor: COLORS.accent, borderColor: COLORS.accentBorder }, metricLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, metricLabel: { color: COLORS.muted, fontSize: 10 }, metricValue: { color: COLORS.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.8, marginTop: 20 }, metricUnit: { color: COLORS.muted, fontSize: 8, fontWeight: '500', letterSpacing: 0 }, metricFoot: { color: COLORS.muted2, fontSize: 8, marginTop: 12 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 12 }, sectionKicker: { color: COLORS.muted2, fontSize: 9, letterSpacing: 1.5, fontWeight: '700' }, sectionTitle: { color: COLORS.text, fontSize: 16, fontWeight: '700' }, monthCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 18 }, monthTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthTotal: { color: COLORS.text, fontSize: 32, fontWeight: '800', letterSpacing: -1.2 }, monthBadge: { color: COLORS.lime, fontSize: 10, borderWidth: 1, borderColor: COLORS.accentBorder, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 5 }, breakdown: { marginTop: 20, gap: 12 }, breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, labelRow: { flexDirection: 'row', alignItems: 'center' }, dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 }, breakdownLabel: { color: COLORS.muted, fontSize: 11 }, breakdownValue: { color: COLORS.text, fontSize: 12, fontWeight: '700' }, progressTrack: { height: 4, backgroundColor: COLORS.surface3, borderRadius: 4, marginTop: 23, overflow: 'hidden' }, progress: { height: '100%', borderRadius: 4, backgroundColor: COLORS.lime }, note: { color: COLORS.muted2, fontSize: 10, marginTop: 10 }, linkButton: { alignSelf: 'flex-start', marginTop: 15 }, linkText: { color: COLORS.lime, fontSize: 11, fontWeight: '700' }, recordRow: { minHeight: 68, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 10 }, recordIcon: { width: 35, height: 35, borderRadius: 10, backgroundColor: COLORS.recordIcon, alignItems: 'center', justifyContent: 'center' }, recordIconExpense: { backgroundColor: COLORS.recordExpense }, recordContent: { flex: 1, minWidth: 0 }, recordTitle: { color: COLORS.text, fontSize: 11, fontWeight: '700' }, recordMeta: { color: COLORS.muted2, fontSize: 9, marginTop: 3 }, recordRight: { alignItems: 'flex-end' }, recordAmount: { color: COLORS.lime, fontSize: 11, fontWeight: '800' }, recordAmountExpense: { color: COLORS.orange }, recordDate: { color: COLORS.muted2, fontSize: 9, marginTop: 3 }, empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, borderRadius: 14, padding: 25, alignItems: 'center', marginTop: 4 }, emptyTitle: { color: COLORS.text, fontSize: 13, fontWeight: '700', marginTop: 10 }, emptyText: { color: COLORS.muted, fontSize: 10, marginTop: 5, marginBottom: 13, textAlign: 'center' }, filterRow: { flexDirection: 'row', gap: 5, marginBottom: 12 }, filterButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 7 }, filterActive: { backgroundColor: COLORS.surface3 }, filterText: { color: COLORS.muted, fontSize: 10 }, filterTextActive: { color: COLORS.text }, searchBox: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, marginBottom: 8 }, searchInput: { flex: 1, color: COLORS.text, fontSize: 11 }, bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 74, paddingHorizontal: 8, paddingBottom: Platform.OS === 'ios' ? 17 : 7, backgroundColor: COLORS.bottomNav, borderTopWidth: 1, borderTopColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, navButton: { width: 55, alignItems: 'center', gap: 3 }, navLabel: { color: COLORS.muted, fontSize: 9 }, navLabelActive: { color: COLORS.lime }, fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.lime, alignItems: 'center', justifyContent: 'center', marginTop: -22, borderWidth: 4, borderColor: COLORS.bg }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.modalOverlay }, modalCard: { maxHeight: '92%', backgroundColor: COLORS.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === 'ios' ? 35 : 20, borderTopWidth: 1, borderColor: COLORS.border }, dateModalBackdrop: { flex: 1, backgroundColor: COLORS.modalOverlay, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }, dateModalCard: { width: '100%', maxWidth: 360, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, padding: 20 }, dateModalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 21 }, dateModalKicker: { color: COLORS.lime, fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 5 }, dateModalTitle: { color: COLORS.text, fontSize: 22, fontWeight: '800' }, dateMonthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17 }, dateNavButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.surface3, alignItems: 'center', justifyContent: 'center' }, dateMonthTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800' }, dateWeekRow: { flexDirection: 'row', marginBottom: 8 }, dateWeekday: { flex: 1, color: COLORS.muted2, fontSize: 10, fontWeight: '700', textAlign: 'center' }, dateGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }, dateDay: { width: '14.2857%', height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, dateDayText: { color: COLORS.text, fontSize: 12, fontWeight: '700' }, dateDaySelected: { backgroundColor: COLORS.lime }, dateDaySelectedText: { color: COLORS.ink }, dateDayToday: { borderWidth: 1, borderColor: COLORS.lime }, dateDayTodayText: { color: COLORS.lime }, dateModalFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 14, marginTop: 18 }, dateSelectedText: { color: COLORS.muted, fontSize: 10 }, dateCancelText: { color: COLORS.lime, fontSize: 11, fontWeight: '800' }, modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }, modalTitle: { color: COLORS.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.7 }, closeButton: { width: 31, height: 31, borderRadius: 8, backgroundColor: COLORS.surface3, alignItems: 'center', justifyContent: 'center' }, field: { marginBottom: 15 }, fieldLabel: { color: COLORS.muted, fontSize: 10, marginBottom: 7 }, inputWrap: { height: 45, backgroundColor: COLORS.surface2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, color: COLORS.text, fontSize: 12, paddingHorizontal: 12 }, inputSuffix: { color: COLORS.muted2, fontSize: 10, paddingHorizontal: 11 }, selectorRow: { gap: 8, paddingBottom: 16 }, selector: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface2, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 8 }, selectorActive: { borderColor: COLORS.lime, backgroundColor: COLORS.selectorActive }, selectorText: { color: COLORS.muted, fontSize: 10 }, selectorTextActive: { color: COLORS.lime, fontWeight: '700' }, formColumns: { flexDirection: 'row', gap: 10 }, column: { flex: 1 }, switchRow: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 17, marginTop: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, switchTitle: { color: COLORS.text, fontSize: 12, fontWeight: '700' }, switchHint: { color: COLORS.muted, fontSize: 9, marginTop: 4 }, modalSave: { marginTop: 23, borderRadius: 10, backgroundColor: COLORS.lime, paddingVertical: 14, alignItems: 'center' }, modalSaveText: { color: COLORS.ink, fontWeight: '800', fontSize: 12 },
  });
}

let styles = makeStyles();

function makeExtraStyles() {
  return StyleSheet.create({
    recordActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    analysisGrid: { flexDirection: 'row', gap: 10 },
    analysisGroup: { flex: 1, minHeight: 236, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 14 },
    analysisGroupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
    analysisGroupTitle: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
    analysisMetric: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 11, marginTop: 10 },
    analysisTitle: { color: COLORS.muted, fontSize: 10 },
    analysisValue: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginTop: 16 },
    analysisNote: { color: COLORS.muted2, fontSize: 9, marginTop: 8 },
    analysisRange: { color: COLORS.muted, fontSize: 9, marginTop: 14 },
    insightCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: COLORS.accent, borderWidth: 1, borderColor: COLORS.accentBorder, borderRadius: 12, padding: 13, marginTop: 10 },
    insightText: { flex: 1, color: COLORS.muted, fontSize: 10, lineHeight: 16 },
    settingsTip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.accent, borderRadius: 10, padding: 12 },
    settingsTipText: { flex: 1, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
    trendPanel: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, marginTop: 12 },
    trendHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 18 },
    rangeSwitch: { flexDirection: 'row', backgroundColor: COLORS.surface2, borderRadius: 8, padding: 3 },
    rangeButton: { paddingHorizontal: 7, paddingVertical: 6, borderRadius: 6 },
    rangeButtonActive: { backgroundColor: COLORS.surface3 },
    rangeText: { color: COLORS.muted, fontSize: 9 },
    rangeTextActive: { color: COLORS.text, fontWeight: '700' },
    trendRow: { marginTop: 3, marginBottom: 17 },
    trendMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
    trendTitle: { color: COLORS.muted, fontSize: 10 },
    trendValue: { fontSize: 10, fontWeight: '800' },
    lineChart: { height: 108, width: '100%', position: 'relative', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingBottom: 19, alignItems: 'center' },
    lineDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, zIndex: 2, marginLeft: -4 },
    lineSegment: { position: 'absolute', height: 2, zIndex: 1, opacity: 0.9 },
    chartLabels: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between' },
    chartLabel: { color: COLORS.muted2, fontSize: 8 },
    noTrend: { height: 74, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border },
    noTrendText: { color: COLORS.muted2, fontSize: 9 },
  });
}

let extraStyles = makeExtraStyles();
