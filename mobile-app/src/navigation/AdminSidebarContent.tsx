import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DrawerContentComponentProps } from '@react-navigation/drawer';
import type { NavigationState, PartialState } from '@react-navigation/native';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import {
  BranchIcon,
  CalendarIcon,
  CalendarViewIcon,
  ChevronIcon,
  ClockIcon,
  CorrectionIcon,
  DeviceIcon,
  CardIcon,
  HomeIcon,
  LeaveIcon,
  ResignedIcon,
  TaskIcon,
  UsersIcon,
  type IconProps,
} from '../components/icons';

type NavChild = { screen: string; params?: object; label: string; icon: (p: IconProps) => JSX.Element; adminOnly: boolean };
type NavItem = { name: string; label: string; icon: (p: IconProps) => JSX.Element; adminOnly: boolean; children?: NavChild[] };

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', label: 'Dashboard', icon: HomeIcon, adminOnly: false },
  {
    name: 'Employees',
    label: 'Employees',
    icon: UsersIcon,
    adminOnly: false,
    children: [
      { screen: 'Shifts', label: 'Shifts', icon: CalendarIcon, adminOnly: true },
      { screen: 'Branches', label: 'Branch/Depart', icon: BranchIcon, adminOnly: true },
      { screen: 'EmployeesList', params: { filter: 'Resigned' }, label: 'Resigned', icon: ResignedIcon, adminOnly: true },
    ],
  },
  {
    name: 'Attendance',
    label: 'Attendance',
    icon: ClockIcon,
    adminOnly: false,
    children: [
      { screen: 'Leave', label: 'Leave', icon: LeaveIcon, adminOnly: false },
      { screen: 'Corrections', label: 'Corrections', icon: CorrectionIcon, adminOnly: false },
      { screen: 'Calendar', label: 'Calendar', icon: CalendarViewIcon, adminOnly: false },
    ],
  },
  { name: 'Payroll', label: 'Payroll', icon: CardIcon, adminOnly: false },
  { name: 'Tasks', label: 'Tasks', icon: TaskIcon, adminOnly: false },
  { name: 'Devices', label: 'Devices', icon: DeviceIcon, adminOnly: true },
];

function innermostRouteName(state: NavigationState | PartialState<NavigationState> | undefined): string | undefined {
  if (!state || state.index === undefined) return undefined;
  const route = state.routes[state.index];
  if (route.state) return innermostRouteName(route.state as NavigationState);
  return route.name;
}

export default function AdminSidebarContent({ state, navigation }: DrawerContentComponentProps) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const role = profile?.role === 'admin' ? 'admin' : 'hr';
  const items = NAV_ITEMS.filter(item => !item.adminOnly || role === 'admin');

  const activeTopName = state.routes[state.index]?.name;
  const activeLeafName = innermostRouteName(state.routes[state.index]?.state as NavigationState | undefined) ?? activeTopName;

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const group = NAV_ITEMS.find(i => i.name === activeTopName && i.children?.some(c => c.screen === activeLeafName));
    if (group) setOpenGroups(prev => (prev.has(group.name) ? prev : new Set(prev).add(group.name)));
  }, [activeTopName, activeLeafName]);

  function toggleGroup(name: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.brand}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brandText}>Attendance Nepal</Text>
      </View>

      {role === 'hr' && (
        <TouchableOpacity style={styles.checkInBtn} onPress={() => navigation.closeDrawer()}>
          <Text style={styles.checkInBtnText}>My Check-In / Out</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={styles.nav} contentContainerStyle={{ paddingBottom: 24 }}>
        {items.map(item => {
          const childItems = (item.children ?? []).filter(c => !c.adminOnly || role === 'admin');
          const hasChildren = childItems.length > 0;
          const isOpen = openGroups.has(item.name);
          const active = activeTopName === item.name && !hasChildren;
          const childActive = childItems.some(c => c.screen === activeLeafName);
          const Icon = item.icon;
          return (
            <View key={item.name}>
              <View style={styles.itemRow}>
                <TouchableOpacity
                  style={[styles.itemLink, (active || childActive) && styles.itemLinkActive]}
                  onPress={() => {
                    navigation.navigate(item.name as never);
                    if (hasChildren) toggleGroup(item.name);
                    else navigation.closeDrawer();
                  }}
                >
                  <Icon size={18} color={active || childActive ? colors.accent : colors.slate400} />
                  <Text style={[styles.itemLabel, (active || childActive) && styles.itemLabelActive]}>{item.label}</Text>
                </TouchableOpacity>
                {hasChildren && (
                  <TouchableOpacity style={styles.chevronBtn} onPress={() => toggleGroup(item.name)}>
                    <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
                      <ChevronIcon size={14} color={colors.slate400} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
              {hasChildren && isOpen && (
                <View style={styles.childList}>
                  {childItems.map(c => {
                    const cActive = activeLeafName === c.screen;
                    const CIcon = c.icon;
                    return (
                      <TouchableOpacity
                        key={c.screen}
                        style={[styles.childLink, cActive && styles.itemLinkActive]}
                        onPress={() => {
                          (navigation as any).navigate(item.name, { screen: c.screen, params: c.params });
                          navigation.closeDrawer();
                        }}
                      >
                        <CIcon size={15} color={cActive ? colors.accent : colors.slate400} />
                        <Text style={[styles.childLabel, cActive && styles.itemLabelActive]}>{c.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.sidebar },
  brand: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, gap: 2 },
  logo: { height: 72, width: 72 },
  brandText: { fontSize: 15, fontWeight: '600', color: colors.white },
  checkInBtn: {
    marginHorizontal: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(13,148,136,0.2)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  checkInBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  nav: { flex: 1, paddingHorizontal: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
  itemLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  itemLinkActive: { backgroundColor: 'rgba(13,148,136,0.16)' },
  itemLabel: { fontSize: 14, color: colors.slate200 },
  itemLabelActive: { color: colors.accent, fontWeight: '600' },
  chevronBtn: { padding: 8, borderRadius: 10 },
  childList: {
    marginLeft: 16,
    marginTop: 2,
    marginBottom: 4,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    gap: 2,
  },
  childLink: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  childLabel: { fontSize: 13, color: colors.slate200 },
});
